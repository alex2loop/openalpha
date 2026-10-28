import type { LLMMessage, LLMRequest } from '@/core/llm'
import type { Memory, MemoryImportance, MemoryScope } from '@/core/types/memory'
import type { PrefAttr, PrefState } from '@/engine/hooks/user-preference-prompts'
import type { HookFn, LLMRequestModifier, RunView } from '@/engine/types/run'
import { abortError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { CHARS_PER_TOKEN, weightedCharCount } from '@/core/stream-events'
import { textOf } from '@/core/utils/message'
import { reserveOptionalLlmCost } from '@/engine/budget/reservation'
import { COMPACT_SUMMARY_PREAMBLE } from '@/engine/constants'
import { appendSystemBlock } from '@/engine/hooks/system-block'
import {
  buildExtractPrompt,
  buildPendingNote,
  buildSavedBlock,
  isPrefAttr,
  PREF_ATTRS,
  VALUE_MAX_CHARS,
} from '@/engine/hooks/user-preference-prompts'
import { streamSettledTurn } from '@/engine/llm-turn'
import { TODO_RESTORED_NOTICE } from '@/engine/loop/todo'
import '@/engine/events'

export const PREFS_PREFIX = 'prefs:'
export const PENDING_PREFIX = 'prefs-pending:'
export const ASKED_PREFIX = 'prefs-asked:'
const PREFS_LIST_MAX = Object.keys(PREF_ATTRS).length
const MESSAGE_MAX_CHARS = 2_000
const EXTRACT_MAX_TOKENS = 256
const EDGE_NON_CONTENT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
const WHITESPACE_RUN_RE = /\s+/g
const NO_PREFERENCE_MESSAGES: readonly string[] = Object.freeze([
  'hi',
  'hello',
  'hey',
  'chào',
  'chao',
  'xin chào',
  'xin chao',
])

export interface UserPreferencesHooks {
  readonly inject: LLMRequestModifier
  readonly extract: HookFn
}

interface Atom {
  readonly attribute: string
  readonly value: string
}

type PrefWrite =
  | {
      readonly kind: 'store'
      readonly key: string
      readonly value: string
      readonly importance: MemoryImportance
    }
  | { readonly kind: 'remove'; readonly key: string }

// App composes this hook because engine has no dependency on memory.
export function createUserPreferencesHooks(deps: {
  readonly memory: Memory
}): UserPreferencesHooks {
  return {
    inject: (run, req) => injectPrefs(deps.memory, run, req),
    extract: (run) => extractPrefs(deps.memory, run),
  }
}

async function injectPrefs(memory: Memory, run: RunView, req: LLMRequest): Promise<LLMRequest> {
  if (!isPreferenceEligibleRun(run)) {
    return req
  }

  const state = await quietly(run, () => readPrefState(memory, scopeOf(run), isAttendedRun(run)))

  if (state === undefined) {
    return req
  }

  const { saved, pending } = state
  const withSaved = saved.size === 0 ? req : appendSystemBlock(req, buildSavedBlock(saved))

  return pending.size === 0
    ? withSaved
    : appendToTypedTurn(withSaved, buildPendingNote(saved, pending))
}

async function extractPrefs(memory: Memory, run: RunView): Promise<void> {
  // A stopped or timed-out run has no reply to learn from; asking the model now would only fail.
  if (!isPreferenceEligibleRun(run) || run.state.turn === 0 || run.state.abort.signal.aborted) {
    return
  }

  const scope = scopeOf(run)
  const attended = isAttendedRun(run)
  const state = await quietly(run, () => readPrefState(memory, scope, attended))

  if (state === undefined) {
    return
  }

  const atoms = await extractAtoms(run, state)

  if (attended) {
    await quietly(run, () => advanceProposals(memory, scope, state))
  }

  for (const atom of atoms) {
    if (run.state.abort.signal.aborted) {
      throw abortError(run.state.abort.signal)
    }

    const write = toPrefWrite(atom, state, attended)

    if (write !== undefined && (await writePref(memory, run, write))) {
      announceSaved(run, write, state)
    }
  }
}

function isPreferenceEligibleRun(run: RunView): boolean {
  return run.env.persistence === 'enabled' && run.env.callDepth === 0
}

/** Only a run someone can answer asks about a change; a scheduled or piped run has nobody to ask. */
function isAttendedRun(run: RunView): boolean {
  return run.env.approvalMode !== 'unavailable'
}

/** Preference bookkeeping is optional work: a memory failure is logged and never fails the reply. */
async function quietly<T>(run: RunView, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch (err: unknown) {
    if (run.state.abort.signal.aborted) {
      throw abortError(run.state.abort.signal)
    }

    run.services.logger.warn('prefs.memory_failed', { err: formatErrForLog(err) })

    return undefined
  }
}

async function readPrefState(
  memory: Memory,
  scope: MemoryScope,
  attended: boolean
): Promise<PrefState> {
  const none = new Map<string, string>()
  const [saved, pending, asked] = await Promise.all([
    listPrefs(memory, scope, PREFS_PREFIX),
    attended ? listPrefs(memory, scope, PENDING_PREFIX) : none,
    attended ? listPrefs(memory, scope, ASKED_PREFIX) : none,
  ])

  return { saved, pending, asked }
}

// The chat model passes over a request buried in a long system prompt but acts on one riding the
// operator's own turn. Only this request copy carries it; the stored history keeps what they typed.
function appendToTypedTurn(req: LLMRequest, note: string): LLMRequest {
  const index = req.messages.findLastIndex(
    (message) => message.role === 'user' && typeof message.content === 'string'
  )

  if (index < 0) {
    return appendSystemBlock(req, note)
  }

  const messages = req.messages.map((message, at) =>
    at === index && typeof message.content === 'string'
      ? { ...message, content: `${message.content}\n\n${note}` }
      : message
  )

  return { ...req, messages }
}

/** The proposals asked in this run's reply wait for the next message; those it answered are done. */
async function advanceProposals(
  memory: Memory,
  scope: MemoryScope,
  state: PrefState
): Promise<void> {
  for (const attr of state.asked.keys()) {
    await memory.remove(scope, `${ASKED_PREFIX}${attr}`)
  }

  for (const [attr, value] of state.pending) {
    await memory.store(scope, `${ASKED_PREFIX}${attr}`, { value, importance: 'observation' })
    await memory.remove(scope, `${PENDING_PREFIX}${attr}`)
  }
}

// Metered call: reserves optional budget immediately ahead of the LLM call so costs are recorded
// before RunResult is snapshotted. RunHalted from budget charge propagates; provider/parse
// failures are warnings.
async function extractAtoms(run: RunView, prefs: PrefState): Promise<readonly Atom[]> {
  const message = lastTypedUserText(run.state.messages.history)

  if (message === undefined || !hasPreferenceContent(message)) {
    return []
  }

  const prompt = buildExtractPrompt(message.slice(0, MESSAGE_MAX_CHARS), prefs)
  const inputTokens = Math.ceil(weightedCharCount(prompt) / CHARS_PER_TOKEN)
  const { state, services, env } = run
  const req: LLMRequest = {
    model: env.agent.model,
    ...(env.agent.preferredProviderModel === undefined
      ? {}
      : { preferredProviderModel: env.agent.preferredProviderModel }),
    routingKey: run.identity.sessionId,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: EXTRACT_MAX_TOKENS,
    reasoningMode: 'off',
    signal: state.abort.signal,
  }
  const estimate = services.chain.estimateMaxCost({
    requestedModel: req.model,
    inputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    maxTokens: EXTRACT_MAX_TOKENS,
    reasoningMode: req.reasoningMode,
    hasOutputContract: req.outputContract !== undefined,
  })

  const reservation = await reserveOptionalLlmCost(run, estimate, 'preference extraction')

  if (reservation === undefined) {
    return []
  }

  try {
    const settled = await streamSettledTurn(services.chain, req, {
      onEvent: () => undefined,
      kind: 'preference',
      run,
      reservation,
    })

    return parseAtoms(textOf(settled.response.content))
  } catch (err: unknown) {
    if (state.abort.signal.aborted) {
      throw abortError(state.abort.signal)
    }

    if (err instanceof RunHalted) {
      throw err
    }

    run.services.logger.warn('prefs.extract_failed', { err: formatErrForLog(err) })

    return []
  } finally {
    reservation.release()
  }
}

// The history also carries user-role messages the engine wrote (the compaction recap, the todo
// restore notice); a preference is read only from what the person typed.
function lastTypedUserText(history: readonly LLMMessage[]): string | undefined {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]

    if (message?.role !== 'user' || typeof message.content !== 'string' || message.content === '') {
      continue
    }

    if (
      message.content.startsWith(COMPACT_SUMMARY_PREAMBLE) ||
      message.content.startsWith(TODO_RESTORED_NOTICE)
    ) {
      continue
    }

    return message.content
  }

  return undefined
}

function hasPreferenceContent(message: string): boolean {
  const normalized = normalizePreferenceContent(message)

  return normalized !== '' && !NO_PREFERENCE_MESSAGES.includes(normalized)
}

function normalizePreferenceContent(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(EDGE_NON_CONTENT_RE, '')
    .trim()
    .replace(WHITESPACE_RUN_RE, ' ')
}

// Secrets and prompt injection are rejected at the canonical memory boundary, so this layer only
// enforces the preference taxonomy. An empty attribute fills directly; a change to a saved one is put
// to the operator first, since the model rewrites the whole value and can drop part of it. An empty
// value is a withdrawal.
function toPrefWrite(atom: Atom, state: PrefState, attended: boolean): PrefWrite | undefined {
  const attr = atom.attribute.trim().toLowerCase()
  const value = atom.value.trim().slice(0, VALUE_MAX_CHARS)
  const current = isPrefAttr(attr) ? state.saved.get(attr) : undefined

  if (!isPrefAttr(attr) || (current === undefined && value === '')) {
    return undefined
  }

  if (current === undefined) {
    return { kind: 'store', key: `${PREFS_PREFIX}${attr}`, value, importance: 'decision' }
  }

  if (isSameValue(current, value)) {
    return undefined
  }

  if (isSameValue(state.asked.get(attr), value)) {
    return toAcceptedWrite(attr, value)
  }

  return attended && !isSameValue(state.pending.get(attr), value)
    ? { kind: 'store', key: `${PENDING_PREFIX}${attr}`, value, importance: 'observation' }
    : undefined
}

function toAcceptedWrite(attr: PrefAttr, value: string): PrefWrite {
  const key = `${PREFS_PREFIX}${attr}`

  return value === ''
    ? { kind: 'remove', key }
    : { kind: 'store', key, value, importance: 'decision' }
}

function isSameValue(left: string | undefined, right: string): boolean {
  return (
    left !== undefined && normalizePreferenceContent(left) === normalizePreferenceContent(right)
  )
}

/** True once the write landed; a refusal is logged and answers false. */
async function writePref(memory: Memory, run: RunView, write: PrefWrite): Promise<boolean> {
  const scope = scopeOf(run)

  try {
    if (write.kind === 'remove') {
      await memory.remove(scope, write.key)
    } else {
      await memory.store(scope, write.key, { value: write.value, importance: write.importance })
    }

    return true
  } catch (err: unknown) {
    if (run.state.abort.signal.aborted) {
      throw abortError(run.state.abort.signal)
    }

    // memory.store rejects secrets by throwing; that is a refusal, not a run failure.
    run.services.logger.warn('prefs.store_failed', { key: write.key, err: formatErrForLog(err) })

    return false
  }
}

// Only a saved preference is told; a pending proposal waits for the operator's answer.
function announceSaved(run: RunView, write: PrefWrite, state: PrefState): void {
  if (!write.key.startsWith(PREFS_PREFIX)) {
    return
  }

  const attribute = write.key.slice(PREFS_PREFIX.length)

  run.services.bus.emit('preference_saved', {
    sessionId: run.identity.sessionId,
    agentId: run.identity.agentId,
    channel: run.identity.channel,
    attribute,
    value: write.kind === 'remove' ? '' : write.value,
    change: toPrefChange(write, state.saved.has(attribute)),
  })
}

function toPrefChange(write: PrefWrite, wasSaved: boolean): 'added' | 'updated' | 'removed' {
  if (write.kind === 'remove') {
    return 'removed'
  }

  return wasSaved ? 'updated' : 'added'
}

function parseAtoms(text: string): readonly Atom[] {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')

  if (start < 0 || end <= start) {
    return []
  }

  try {
    const raw: unknown = JSON.parse(text.slice(start, end + 1))

    return Array.isArray(raw) ? raw.filter(isAtom) : []
  } catch {
    // A non-JSON reply means the model found nothing worth extracting.
    return []
  }
}

function isAtom(value: unknown): value is Atom {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return (
    'attribute' in value &&
    typeof value.attribute === 'string' &&
    'value' in value &&
    typeof value.value === 'string'
  )
}

async function listPrefs(
  memory: Memory,
  scope: MemoryScope,
  prefix: string
): Promise<ReadonlyMap<string, string>> {
  const entries = await memory.list(scope, { prefix, limit: PREFS_LIST_MAX })

  return new Map(entries.map((entry) => [entry.key.slice(prefix.length), entry.value]))
}

function scopeOf(run: RunView): MemoryScope {
  return { agentId: run.identity.agentId, userId: run.identity.userId }
}

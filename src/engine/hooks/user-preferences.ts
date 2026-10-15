import type { LLMMessage, LLMRequest } from '@/core/llm'
import type { Memory, MemoryScope } from '@/core/types/memory'
import type { HookFn, LLMRequestModifier, RunView } from '@/engine/types/run'
import { abortError, RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { escapeXml } from '@/core/security/sanitize'
import { CHARS_PER_TOKEN, weightedCharCount } from '@/core/stream-events'
import { textOf } from '@/core/utils/message'
import { reserveOptionalLlmCost } from '@/engine/budget/reservation'
import { COMPACT_SUMMARY_PREAMBLE } from '@/engine/constants'
import { appendSystemBlock } from '@/engine/hooks/system-block'
import { streamSettledTurn } from '@/engine/llm-turn'
import { TODO_RESTORED_NOTICE } from '@/engine/loop/todo'

// Single source of truth for the durable-preference taxonomy: the extraction prompt and the
// write-time validation both derive from it. A closed set keeps memory bounded and
// self-consolidating (one row per attribute). Chosen to complement the user profile
// (risk, horizon, goal, watchlist) and locale (language), not overlap them.
const PREF_ATTRS = {
  style: 'investing philosophy (e.g. "trusts fundamentals over charts, dislikes day-trading")',
  constraints: 'hard personal rules (e.g. "never uses margin", "avoids crypto")',
  interests: 'sectors/themes/assets they follow (e.g. "banks, tech, gold")',
  context: 'durable personal context (e.g. "retired", "checks markets in the evening")',
  communication: 'how they want answers (e.g. "keep it brief", "explain jargon")',
} as const

type PrefAttr = keyof typeof PREF_ATTRS

const PREFS_PREFIX = 'prefs:'
const PREFS_LIST_MAX = Object.keys(PREF_ATTRS).length
const VALUE_MAX_CHARS = 200
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

// App composes this hook because engine has no dependency on memory.
export function createUserPreferencesHooks(deps: {
  readonly memory: Memory
}): UserPreferencesHooks {
  return {
    inject: async (run, req) => {
      if (!isPreferenceEligibleRun(run)) {
        return req
      }

      const entries = await deps.memory.list(scopeOf(run), {
        prefix: PREFS_PREFIX,
        limit: PREFS_LIST_MAX,
      })

      if (entries.length === 0) {
        return req
      }

      // Stored values already passed the canonical secret and injection policy, so only escaping is
      // needed before interpolation.
      const lines: string[] = []

      for (const e of entries) {
        lines.push(`- ${escapeXml(e.key.slice(PREFS_PREFIX.length))}: ${escapeXml(e.value)}`)
      }

      if (lines.length === 0) {
        return req
      }

      return appendSystemBlock(req, `<user_preferences>\n${lines.join('\n')}\n</user_preferences>`)
    },

    extract: async (run) => {
      if (!isPreferenceEligibleRun(run) || run.state.turn === 0) {
        return
      }

      const atoms = await extractAtoms(run)

      for (const atom of atoms) {
        if (run.state.abort.signal.aborted) {
          throw abortError(run.state.abort.signal)
        }

        await storePref(deps.memory, run, atom)
      }
    },
  }
}

function isPreferenceEligibleRun(run: RunView): boolean {
  return run.env.persistence === 'enabled' && run.env.callDepth === 0
}

// Metered call: reserves optional budget immediately ahead of the LLM call so costs are recorded
// before RunResult is snapshotted. RunHalted from budget charge propagates; provider/parse
// failures are warnings.
async function extractAtoms(run: RunView): Promise<readonly Atom[]> {
  const message = lastTypedUserText(run.state.messages.history)

  if (message === undefined || !hasPreferenceContent(message)) {
    return []
  }

  const prompt = buildExtractPrompt(message.slice(0, MESSAGE_MAX_CHARS))
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
    cacheWriteTokens: inputTokens,
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

// Guarded write: known attribute and non-empty value. Secrets and prompt injection are rejected at
// the canonical memory boundary, so this layer only enforces the preference taxonomy.
async function storePref(memory: Memory, run: RunView, atom: Atom): Promise<void> {
  const attr = atom.attribute.trim().toLowerCase()
  const value = atom.value.trim().slice(0, VALUE_MAX_CHARS)

  if (!isPrefAttr(attr) || value === '') {
    return
  }

  const scope = scopeOf(run)
  const key = `${PREFS_PREFIX}${attr}`

  try {
    if ((await memory.recall(scope, key)) !== null) {
      return
    }

    await memory.store(scope, key, { value, importance: 'decision' })
  } catch (err: unknown) {
    if (run.state.abort.signal.aborted) {
      throw abortError(run.state.abort.signal)
    }

    // memory.store rejects secrets by throwing; that is a refusal, not a run failure.
    run.services.logger.warn('prefs.store_failed', { attr, err: formatErrForLog(err) })
  }
}

function buildExtractPrompt(message: string): string {
  const attrLines = Object.entries(PREF_ATTRS).map(([attr, hint]) => `- ${attr}: ${hint}`)

  return [
    'Extract DURABLE preferences the user states about how they invest or want to be advised.',
    'Return ONLY a JSON array of {"attribute","value"} objects, or [] if the message states none.',
    'attribute MUST be one of:',
    ...attrLines,
    `value: a short phrase (max ${VALUE_MAX_CHARS} chars), in the user's own terms.`,
    'Only EXPLICIT, durable preferences - never infer, never one-off opinions, predictions, or mood.',
    'Do NOT include risk level, horizon, goal, watchlist tickers, or language.',
    'Those belong to the investor profile. If unsure, omit.',
    '',
    'Message:',
    `"""${message}"""`,
  ].join('\n')
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

function isPrefAttr(value: string): value is PrefAttr {
  return Object.hasOwn(PREF_ATTRS, value)
}

function scopeOf(run: RunView): MemoryScope {
  return { agentId: run.identity.agentId, userId: run.identity.userId }
}

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { ResolvedConfig } from '@/core/config/resolve'
import type { LLMAttemptId } from '@/core/ids'
import type {
  AssistantMessage,
  LLMMessage,
  NonAssistantMessage,
  SessionMessageWrite,
} from '@/core/llm'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { ByteBudget, ToolDefinition } from '@/core/tool'
import type { AgentProfile } from '@/engine/types/agent'
import type {
  MessageStore,
  ParentLink,
  ResolvedRunLimits,
  RunEnv,
  RunIdentity,
  RunInput,
  RunOptions,
  RunState,
} from '@/engine/types/run'
import { reasoningBudgetOf } from '@/ai/api'
import { ToolError } from '@/core/errors'
import { type RunId, runId } from '@/core/ids'
import { DEFAULT_MAX_TOKENS } from '@/core/stream-events'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { createDelegationQuota } from '@/engine/budget/delegation-quota'
import { createConfiguredRunBudget } from '@/engine/budget/run-budget'
import { trimMessageGroups } from '@/engine/compact/message-repair'
import {
  DEFAULT_CONTEXT_WINDOW,
  SKILL_VIEW_RUN_BUDGET_BYTES,
  TOOL_RESULT_MAX_BYTES,
} from '@/engine/constants'
import { createThinkingState, type ThinkingState } from '@/engine/loop/thinking'
import { createTodoSlot } from '@/engine/loop/todo'
import { createToolExposure } from '@/engine/loop/tools/exposure'
import { NO_DEADLINE } from '@/engine/run-registry'

const MIN_SESSION_MESSAGE_CAP = 1
const MIN_POSITIVE_LIMIT = 1
const NO_CALL_SITE_LIMIT = Number.POSITIVE_INFINITY

type AssistantMessageWrite = Extract<SessionMessageWrite, { readonly message: AssistantMessage }>

// Single ledger: usage/cost facts live in RunState.totals, the transient settled response, and
// the durable llm_attempts rows — this holds only the loop's own transient progress.
export interface RunBookkeeping {
  compactionPasses: number
  turnRestarts: number
  estimator?: { readonly tokens: number }
  thinking: ThinkingState
}

export interface RunDeps {
  readonly tools: ReadonlyMap<string, ToolDefinition>
  readonly config: ResolvedConfig
  /** Frozen boot-computed env allowlist; per-run HOME/TMPDIR are layered on top without mutating it. */
  readonly childEnvBase: Readonly<Record<string, string>>
  readonly workspace: WorkspaceIdentity
}

interface ResolveRunLimitsInput {
  readonly config: ResolvedConfig
  readonly agent: AgentProfile
  readonly options: RunOptions
  readonly contextWindow: number
}

interface MessageBuffers {
  readonly history: LLMMessage[]
  readonly pending: AssistantMessageWrite[]
  // Durable trail is append-only and independent of the model's prompt window: rows appended here
  // stay queued for the sink until flushed, even when compaction shrinks `history` underneath them.
  readonly unpersisted: SessionMessageWrite[]
  readonly cap: number
  readonly ownerRunId: RunId
  latestAssistant: AssistantMessage | undefined
}

function createMessageStore(sessionMessageCap: number, ownerRunId: RunId): MessageStore {
  const buffers: MessageBuffers = {
    history: [],
    pending: [],
    unpersisted: [],
    cap: Math.max(MIN_SESSION_MESSAGE_CAP, Math.floor(sessionMessageCap)),
    ownerRunId,
    latestAssistant: undefined,
  }

  return {
    get history(): readonly LLMMessage[] {
      return buffers.history
    },
    get latestAssistant(): AssistantMessage | undefined {
      return buffers.latestAssistant
    },
    historyWindow: buffers.cap + 1,
    pushToPending: (message, llmAttemptIds) => pushToPending(buffers, message, llmAttemptIds),
    flushPending: () => flushPending(buffers),
    clearPending: () => {
      buffers.pending.length = 0
    },
    appendDirect: (message) => appendDirect(buffers, message),
    appendTransient: (message) => appendTransient(buffers, message),
    loadHistory: (messages) => loadHistory(buffers, messages),
    replaceLastAssistant: (previous, message) => replaceLastAssistant(buffers, previous, message),
    replaceAll: (messages) => replaceAll(buffers, messages),
    takeUnpersisted: () => takeUnpersisted(buffers),
    restoreUnpersisted: (writes) => {
      buffers.unpersisted.unshift(...writes)
    },
  }
}

function pushToPending(
  buffers: MessageBuffers,
  message: AssistantMessage,
  llmAttemptIds: readonly [LLMAttemptId, ...LLMAttemptId[]]
): void {
  buffers.pending.push({ runId: buffers.ownerRunId, message, llmAttemptIds })
}

function flushPending(buffers: MessageBuffers): void {
  if (buffers.pending.length === 0) {
    return
  }

  buffers.history.push(...buffers.pending.map((write) => write.message))
  buffers.unpersisted.push(...buffers.pending)
  buffers.latestAssistant = buffers.pending.at(-1)?.message
  buffers.pending.length = 0
  enforceMessageCap(buffers.history, buffers.cap)
}

function appendDirect(buffers: MessageBuffers, message: NonAssistantMessage): void {
  buffers.history.push(message)
  buffers.unpersisted.push({ runId: buffers.ownerRunId, message })
  enforceMessageCap(buffers.history, buffers.cap)
}

function appendTransient(buffers: MessageBuffers, message: NonAssistantMessage): void {
  buffers.history.push(message)
  enforceMessageCap(buffers.history, buffers.cap)
}

function loadHistory(buffers: MessageBuffers, messages: readonly LLMMessage[]): void {
  replaceAll(buffers, messages)
  buffers.unpersisted.length = 0
}

function replaceAll(buffers: MessageBuffers, messages: readonly LLMMessage[]): void {
  buffers.history.length = 0
  buffers.history.push(...messages)
  buffers.pending.length = 0
  enforceMessageCap(buffers.history, buffers.cap)
}

function replaceLastAssistant(
  buffers: MessageBuffers,
  previous: AssistantMessage,
  message: AssistantMessage
): void {
  if (buffers.history.at(-1) !== previous) {
    return
  }

  buffers.history[buffers.history.length - 1] = message

  if (buffers.latestAssistant === previous) {
    buffers.latestAssistant = message
  }

  for (const [index, write] of buffers.unpersisted.entries()) {
    buffers.unpersisted[index] = replaceQueuedAssistant(write, previous, message)
  }
}

function takeUnpersisted(buffers: MessageBuffers): readonly SessionMessageWrite[] {
  const taken = buffers.unpersisted.slice()
  buffers.unpersisted.length = 0

  return taken
}

function replaceQueuedAssistant(
  write: SessionMessageWrite,
  previous: AssistantMessage,
  message: AssistantMessage
): SessionMessageWrite {
  if (write.message !== previous || !isAssistantMessageWrite(write)) {
    return write
  }

  return { runId: write.runId, message, llmAttemptIds: write.llmAttemptIds }
}

function isAssistantMessageWrite(write: SessionMessageWrite): write is AssistantMessageWrite {
  return write.message.role === 'assistant'
}

function resolveRunLimits(input: ResolveRunLimitsInput): ResolvedRunLimits {
  const base = input.config.loop
  const maxTurns = Math.min(
    normalizePositiveInteger(base.maxTurns),
    normalizePositiveInteger(input.agent.maxTurns),
    normalizeOptionalPositiveInteger(input.options.maxTurns)
  )
  const maxDurationMs = Math.min(
    normalizePositiveInteger(base.maxDurationMs),
    normalizeOptionalPositiveInteger(input.agent.maxDurationMs),
    normalizeOptionalPositiveInteger(input.options.maxDurationMs)
  )
  const reasoningMode = input.agent.reasoningMode
  const reasoningHeadroom =
    reasoningMode === 'default' || reasoningMode === 'off' ? 0 : reasoningBudgetOf(reasoningMode)

  return {
    maxTurns,
    maxToolCalls: normalizePositiveInteger(base.maxToolCalls),
    maxDurationMs,
    toolTimeoutMs: input.options.toolTimeoutMs ?? maxDurationMs,
    toolResultMaxBytes: input.options.toolResultMaxBytes ?? TOOL_RESULT_MAX_BYTES,
    maxTokens: Math.min(
      DEFAULT_MAX_TOKENS + reasoningHeadroom,
      normalizeOptionalPositiveInteger(input.agent.maxTokens)
    ),
    contextWindow: input.contextWindow,
    compactionThreshold: base.compactionThreshold,
    maxCompactionPasses: base.maxCompactionPasses,
    approvalTimeoutMs: input.options.approvalTimeoutMs ?? base.approvalTimeoutMs,
    sessionMessageCap: base.sessionMessageCap,
  }
}

export function assembleRun(
  deps: RunDeps,
  ...args: [RunInput, RunOptions, AgentProfile, ParentLink?]
): {
  readonly identity: RunIdentity
  readonly env: RunEnv
  readonly state: RunState
  bookkeeping: RunBookkeeping
} {
  const [input, options, agent, parent] = args
  const identity = buildIdentity(input, options)
  const callDepth = parent === undefined ? 0 : parent.callDepth + 1
  const tools = resolveAgentTools(agent, deps.tools, options.allowedTools)
  const limits = resolveRunLimits({
    config: deps.config,
    agent,
    options: options,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
  })
  const budget =
    parent?.sharedBudget ?? options.budgetSlice ?? createConfiguredRunBudget(deps.config)
  const messages = createMessageStore(limits.sessionMessageCap, identity.runId)
  const workspace = deps.workspace
  const workspaceDir = workspace.path
  const childEnv = buildChildEnv(deps.childEnvBase, workspaceDir)

  return {
    identity,
    env: {
      config: deps.config,
      agent,
      tools,
      locale: deps.config.locale.language,
      approvalMode: options.approvalMode ?? 'manual',
      ...(options.approval === undefined ? {} : { approval: options.approval }),
      audience: options.audience ?? 'agent',
      callDepth,
      delegationChain: parent?.delegationChain ?? [],
      workspace,
      workspaceDir,
      childEnv,
      limits,
      persistence: options.persistence ?? 'enabled',
      ...optionalEnvFields(options),
    },
    state: buildRunState({ deps, options, parent, tools, messages, budget }),
    bookkeeping: { compactionPasses: 0, turnRestarts: 0, thinking: createThinkingState() },
  }
}

interface RunStateInput {
  readonly deps: RunDeps
  readonly options: RunOptions
  readonly parent: ParentLink | undefined
  readonly tools: RunEnv['tools']
  readonly messages: RunState['messages']
  readonly budget: RunState['budget']
}

function buildRunState(input: RunStateInput): RunState {
  const { deps, options, parent } = input

  return {
    messages: input.messages,
    toolExposure: createToolExposure(input.tools),
    todo: createTodoSlot(),
    turn: 0,
    totals: options.initialTotals ?? EMPTY_LLM_USAGE_TOTALS,
    priorCostUsd: options.initialTotals?.costUsd ?? 0,
    budget: input.budget,
    skillViewBudget: createByteBudget(SKILL_VIEW_RUN_BUDGET_BYTES),
    delegationQuota:
      parent?.delegationQuota ?? createDelegationQuota(deps.config.loop.maxDelegations),
    abort: new AbortController(),
    deadline: NO_DEADLINE,
    ...(options.toolResultCache === undefined ? {} : { toolResultCache: options.toolResultCache }),
  }
}

function optionalEnvFields(
  options: RunOptions
): Pick<
  RunEnv,
  | 'outputContract'
  | 'answerVisibility'
  | 'reasoningVisibility'
  | 'researchInteraction'
  | 'instructions'
  | 'routingKey'
  | 'title'
> {
  return {
    ...(options.outputContract === undefined ? {} : { outputContract: options.outputContract }),
    ...(options.answerVisibility === undefined
      ? {}
      : { answerVisibility: options.answerVisibility }),
    ...(options.reasoningVisibility === undefined
      ? {}
      : { reasoningVisibility: options.reasoningVisibility }),
    ...(options.researchInteraction === undefined
      ? {}
      : { researchInteraction: options.researchInteraction }),
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    ...(options.routingKey === undefined ? {} : { routingKey: options.routingKey }),
    ...(options.title === undefined ? {} : { title: options.title }),
  }
}

function buildIdentity(input: RunInput, options: RunOptions): RunIdentity {
  const identity: RunIdentity = {
    runId: runId(randomUUID()),
    sessionId: input.sessionId,
    billingSessionId:
      options.billingSessionId === undefined ? input.sessionId : options.billingSessionId,
    agentId: input.agentId,
    billingAgentId: options.billingAgentId ?? input.agentId,
    userId: input.userId,
    channel: input.channel,
    ...(options.parentRunId === undefined ? {} : { parentRunId: options.parentRunId }),
  }

  if (options.chatId !== undefined) {
    return { ...identity, chatId: options.chatId }
  }

  return identity
}

/** An allowlist is honored as given, empty included: a caller that means "no tools" has no other
 *  way to say it, and every caller that means "no restriction" omits the field. */
function resolveAgentTools(
  agent: AgentProfile,
  tools: ReadonlyMap<string, ToolDefinition>,
  allowedTools?: readonly string[]
): readonly ToolDefinition[] {
  const allowed = new Set(agent.tools)
  const resolved: ToolDefinition[] = []

  if (allowedTools !== undefined) {
    const restricted = new Set(allowedTools)

    for (const tool of tools.values()) {
      if (allowed.has(tool.name) && restricted.has(tool.name)) {
        resolved.push(tool)
      }
    }

    return resolved
  }

  for (const tool of tools.values()) {
    if (allowed.has(tool.name)) {
      resolved.push(tool)
    }
  }

  return resolved
}

// Closure state, not module state: the allowance dies with the run that owns it, so nothing
// has to remember to clear it (legacy keyed a WeakMap on the mutable RunContext instead).
function createByteBudget(limitBytes: number): ByteBudget {
  let spent = 0

  return {
    charge(bytes: number): void {
      if (spent + bytes > limitBytes) {
        throw new ToolError(
          'payload_too_large',
          `per-run skill_view budget of ${limitBytes} bytes exhausted`
        )
      }

      spent += bytes
    },
  }
}

function normalizeOptionalPositiveInteger(value: number | undefined): number {
  if (value === undefined) {
    return NO_CALL_SITE_LIMIT
  }

  return normalizePositiveInteger(value)
}

function normalizePositiveInteger(value: number): number {
  if (!Number.isFinite(value) || value < MIN_POSITIVE_LIMIT) {
    return MIN_POSITIVE_LIMIT
  }

  return Math.floor(value)
}

function enforceMessageCap(history: LLMMessage[], cap: number): void {
  if (history.length <= cap) {
    return
  }

  const trimmed = trimMessageGroups(history, cap)

  history.length = 0
  history.push(...trimmed)
}

// HOME/TMPDIR/TEMP select prepared scratch paths but do not confine an approved shell process.
function buildChildEnv(
  base: Readonly<Record<string, string>>,
  workspaceDir: string
): Readonly<Record<string, string>> {
  const home = join(workspaceDir, 'run')
  const tmp = join(workspaceDir, 'tmp')

  return Object.freeze({ ...base, HOME: home, TMPDIR: tmp, TMP: tmp, TEMP: tmp })
}

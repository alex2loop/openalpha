import type { Pricing } from '@/ai/api'
import type { ChannelId } from '@/core/channels'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { HaltCode, HaltDetail, OperatorMessage, ToolError } from '@/core/errors'
import type { EventBus } from '@/core/events'
import type { AgentId, LLMAttemptId, RunId, SessionId, UserId } from '@/core/ids'
import type {
  AssistantMessage,
  JsonOutputContract,
  LLMMessage,
  LLMRequest,
  LLMResponse,
  NonAssistantMessage,
  ProviderChain,
  SessionMessageWrite,
} from '@/core/llm'
import type { Logger } from '@/core/logging/logger'
import type { WorkspaceIdentity } from '@/core/security/path-policy'
import type { DisplayText, OnStreamEvent, ProgressMessage } from '@/core/stream-events'
import type {
  ApprovalMode,
  ByteBudget,
  DelegationQuota,
  RunDeadline,
  ToolAudience,
  ToolCall,
  ToolDefinition,
  ToolResult,
  ToolSchema,
} from '@/core/tool'
import type { Budget } from '@/core/types/budget'
import type { Locale } from '@/core/types/locale'
import type { RunCompletionCode, RunResultReason } from '@/core/types/run'
import type { LLMUsageTotals } from '@/core/types/usage'
import type { ForegroundResearchInteraction } from '@/engine/research/contracts'
import type { AgentProfile } from '@/engine/types/agent'
import type { ToolApproval } from '@/engine/types/approval'
import type {
  CostTracker,
  LLMAttemptSink,
  RateLimiter,
  UnrecordedSpendLog,
} from '@/engine/types/cost'
import type { ResolvedToolPresentation } from '@/engine/types/presentation'

// Availability, not correctness: the request itself was never refused on its merits.
const RETRYABLE_HALT_DETAILS: ReadonlySet<HaltDetail> = new Set(['rate', 'transient', 'timeout'])

export interface RunIdentity {
  readonly runId: RunId
  readonly sessionId: SessionId
  /** Session linked to this run's LLM attempts; null when no durable session owns them. */
  readonly billingSessionId: SessionId | null
  readonly agentId: AgentId
  /** The agent whose daily cap this run's spend counts against: the one that asked for the run,
   *  which a delegated or research child inherits and a debate persona names. */
  readonly billingAgentId: AgentId
  readonly userId: UserId
  readonly channel: ChannelId
  readonly chatId?: string
  readonly parentRunId?: RunId
}

export interface ResolvedRunLimits {
  readonly maxTurns: number
  readonly maxToolCalls: number
  readonly maxDurationMs: number
  readonly toolTimeoutMs: number
  readonly toolResultMaxBytes: number
  readonly maxTokens: number
  // Deliberately mutable: the run corrects it in place once the provider reports the real window.
  contextWindow: number
  readonly compactionThreshold: number
  readonly maxCompactionPasses: number
  readonly approvalTimeoutMs: number
  readonly sessionMessageCap: number
}

export interface RunEnv {
  readonly config: ResolvedConfig
  readonly agent: AgentProfile
  readonly tools: readonly ToolDefinition[]
  readonly locale: Locale
  readonly approvalMode: ApprovalMode
  readonly approval?: ToolApproval
  readonly audience: ToolAudience
  readonly callDepth: number
  readonly delegationChain: readonly AgentId[]
  readonly workspace: WorkspaceIdentity
  /** Prepared canonical cwd for shell execution; it is not OS-level confinement. */
  readonly workspaceDir: string
  /** Frozen env the spawned shell receives: boot allowlist + per-run HOME/TMPDIR/TEMP. */
  readonly childEnv: Readonly<Record<string, string>>
  readonly limits: ResolvedRunLimits
  readonly persistence: 'enabled' | 'ephemeral'
  readonly outputContract?: JsonOutputContract
  readonly answerVisibility?: 'hidden'
  readonly reasoningVisibility?: 'hidden'
  readonly instructions?: string
  readonly routingKey?: string
  /** Foreground research seam for this run only; delegated children never inherit it. */
  readonly researchInteraction?: ForegroundResearchInteraction
}

export interface RunServices {
  readonly chain: ProviderChain
  readonly hooks: Hooks
  readonly compactor: Compactor
  readonly executor: ToolExecutor
  readonly costTracker: CostTracker
  readonly llmAttemptSink: LLMAttemptSink
  readonly unrecordedSpend: UnrecordedSpendLog
  readonly rateLimiter: RateLimiter
  readonly logger: Logger
  readonly bus: EventBus
  readonly pricing: Pricing
}

export interface ToolExposure {
  toSchemas(): readonly ToolSchema[]
  exposedNames(): ReadonlySet<string>
  search(input: unknown): ToolResult
  /** Withdraws every schema for the rest of the run, so the next turn can only answer. */
  close(): void
}

/** The run's copy of the list, held outside the transcript so compaction cannot summarize it away. */
export interface TodoSlot {
  current(): string | undefined
  set(checklist: string): void
}

export interface RunState {
  readonly messages: MessageStore
  readonly toolExposure: ToolExposure
  // The list's copy of record: the transcript's copy is summarized away, this one is not.
  readonly todo: TodoSlot
  turn: number
  totals: LLMUsageTotals
  readonly budget: Budget
  // Cumulative skill_view allowance; goes out of scope with the run, so nothing has to clear it.
  readonly skillViewBudget: ByteBudget
  // Shared run-tree fan-out quota; created for top-level runs and inherited by children.
  readonly delegationQuota: DelegationQuota
  // Both are installed by whoever composed the run's abort (loop or MCP invoke).
  abort: AbortController
  deadline: RunDeadline
  readonly toolResultCache?: ToolResultCache
}

export interface RunView {
  readonly identity: RunIdentity
  readonly env: RunEnv
  readonly state: RunState
  readonly services: RunServices
}

export interface RunInput {
  readonly agentId: AgentId
  readonly sessionId: SessionId
  readonly userId: UserId
  readonly channel: ChannelId
  readonly userMessage: string
  /** Read by the model just ahead of `userMessage`, for this run only; never stored, so a history
   *  surface shows only what the operator typed. */
  readonly lead?: string
  readonly onChunk?: OnStreamEvent
}

// Set only for a delegated child. The child's context derives its own depth from this parent.
export interface ParentLink {
  readonly callDepth: number
  readonly sharedBudget?: Budget
  readonly delegationChain: readonly AgentId[]
  readonly delegationQuota?: DelegationQuota | undefined
}

export interface RunOptions {
  readonly approvalMode?: ApprovalMode
  readonly approval?: ToolApproval
  readonly audience?: ToolAudience
  readonly approvalTimeoutMs?: number
  readonly chatId?: string
  readonly parentSignal?: AbortSignal
  readonly budgetSlice?: Budget
  readonly parent?: ParentLink
  readonly maxTurns?: number
  readonly maxDurationMs?: number
  /** Set only by the MCP invoker: a served call may outlive `[loop] max_duration_ms`. */
  readonly toolTimeoutMs?: number
  /** Set only by the MCP invoker: the client, not this loop, budgets its context. */
  readonly toolResultMaxBytes?: number
  /** Link attempts to another session, or null when the run has no durable session. */
  readonly billingSessionId?: SessionId | null
  /** Counts this run's spend against another agent's cap; absent bills to the run's own agent. */
  readonly billingAgentId?: AgentId
  readonly parentRunId?: RunId
  /** Runs once after engine admission and before any metered work starts. */
  readonly onWorkStart?: () => Promise<void>
  /** Further restrict the agent's tools to this subset. Ignored when empty or undefined. */
  /** Names the tools this run may use. Empty exposes none; omit the field for no restriction. */
  readonly allowedTools?: readonly string[]
  /** Cumulative totals to seed the run with (a resumed session's prior aggregate). */
  readonly initialTotals?: LLMUsageTotals
  /** Persist the run's transcript to the session trail, or keep it in-memory only. */
  readonly persistence?: 'enabled' | 'ephemeral'
  /** Optional cache for reusing successful tool results within one research request. */
  readonly toolResultCache?: ToolResultCache
  /** Provider-enforced shape when the selected endpoint supports this JSON contract. */
  readonly outputContract?: JsonOutputContract
  /** Keep structured answers internal until the research boundary validates them. */
  readonly answerVisibility?: 'hidden'
  /** Keep reasoning available to the transport without exposing it as streamed user output. */
  readonly reasoningVisibility?: 'hidden'
  /** Run-specific rules that ride the system prompt, so runs sharing them share a prompt cache. */
  readonly instructions?: string
  /** A stable routing key for runs whose session is per call; see `LLMRequest.routingKey`. */
  readonly routingKey?: string
  /** Foreground research seam supplied by the surface that started this run. */
  readonly researchInteraction?: ForegroundResearchInteraction
}

export interface MessageStore {
  readonly history: readonly LLMMessage[]
  /** Newest transcript rows a resumed run loads: one past the cap, so trim sees group starts. */
  readonly historyWindow: number
  /** Queue one assistant message with the durable attempt group that produced it. */
  pushToPending(
    message: AssistantMessage,
    llmAttemptIds: readonly [LLMAttemptId, ...LLMAttemptId[]]
  ): void
  flushPending(): void
  clearPending(): void
  appendDirect(message: NonAssistantMessage): void
  /** Prompt-only append: enters the model's window, never the durable transcript a human reads. */
  appendTransient(message: NonAssistantMessage): void
  loadHistory(messages: readonly LLMMessage[]): void
  replaceLastAssistant(previous: AssistantMessage, message: AssistantMessage): void
  replaceAll(messages: readonly LLMMessage[]): void
  takeUnpersisted(): readonly SessionMessageWrite[]
  restoreUnpersisted(writes: readonly SessionMessageWrite[]): void
}

/** The caps this run actually ran under, so a limit hint can name the effective value. */
export interface RunResultLimits {
  readonly maxTurns: number
  readonly maxToolCalls: number
  readonly maxDurationMs: number
}

export interface RunResult {
  readonly reason: RunResultReason
  readonly text: string
  readonly totals: LLMUsageTotals
  /** True once this invocation passes engine admission; prior session totals are irrelevant. */
  readonly workStarted: boolean
  readonly limits?: RunResultLimits
  readonly haltCode?: HaltCode
  readonly haltDetail?: HaltDetail
  readonly errorMessage?: string
  /** The failure in the operator's own words, when the error carried them. */
  readonly operator?: OperatorMessage
  /** The unset key variable the failure came from. A key arrives with a restart, so a caller that
   *  would retry or count the failure skips it instead. */
  readonly missingEnv?: string
  readonly completionCode?: RunCompletionCode
  readonly model?: string
}

export interface Runner {
  run(input: RunInput, options?: RunOptions): Promise<RunResult>
}

export type HookFn = (run: RunView) => Promise<void>

export type AfterLLMHook = (run: RunView, res: LLMResponse) => Promise<void>

/** A halt the provider chain already exhausted its own fallbacks on, and which a later call may
 *  still clear: every configured entry was cooling or unreachable. A caller that can afford one
 *  more call re-asks, because the chain waits the cooldown out before its next attempt. */
export function isRetryableHalt(result: RunResult): boolean {
  return result.haltDetail !== undefined && RETRYABLE_HALT_DETAILS.has(result.haltDetail)
}

// Halts the run on failure instead of logging and skipping. Wraps rather than tagging in place:
// a tag would mark every other holder of the same function object.
export function critical<Args extends unknown[], R>(
  fn: (...args: Args) => R
): (...args: Args) => R {
  const marked = (...args: Args): R => fn(...args)

  return Object.assign(marked, { critical: true as const })
}

export function isCriticalHook(fn: unknown): boolean {
  return typeof fn === 'function' && 'critical' in fn && fn.critical === true
}

export type ToolGateResult =
  | { readonly action: 'allow' }
  | { readonly action: 'block'; readonly message: string; readonly error?: ToolError }
  | { readonly action: 'warn'; readonly message: string }

export interface PreparedToolCall extends ToolCall {
  readonly tool: ToolDefinition
  readonly presentation: ResolvedToolPresentation
}

interface ToolResultCache {
  getOrExecute(
    run: RunView,
    call: PreparedToolCall,
    execute: () => Promise<ToolResult>
  ): Promise<ToolResult>
}

export type ToolPreparation =
  | { readonly kind: 'ready'; readonly prepared: PreparedToolCall }
  | { readonly kind: 'rejected'; readonly result: ToolResult }

export type ToolGate<Call extends ToolCall = ToolCall> = (
  run: RunView,
  call: Call
) => Promise<ToolGateResult>

export type ApprovalGate = ToolGate<PreparedToolCall>

export type AfterToolHook = (run: RunView, call: ToolCall, result: ToolResult) => Promise<void>

export type AfterRunHook = (run: RunView, result: RunResult) => Promise<void>

export type LLMRequestModifier = (run: RunView, req: LLMRequest) => LLMRequest | Promise<LLMRequest>

export interface Hooks {
  readonly beforeRun: readonly HookFn[]
  readonly beforeLLM: readonly HookFn[]
  readonly llmRequestModifiers: readonly LLMRequestModifier[]
  readonly afterLLM: readonly AfterLLMHook[]
  readonly toolAdmission: readonly ToolGate[]
  readonly approvalGate: ApprovalGate
  readonly afterTool: readonly AfterToolHook[]
  readonly afterTurn: readonly HookFn[]
  readonly beforeFinalize: readonly HookFn[]
  readonly afterRun: readonly AfterRunHook[]
}

export interface Compactor {
  compact(run: RunView): Promise<void>
}

export type RunLifecycle =
  | 'running'
  | 'done'
  | 'aborted'
  | 'failed'
  | 'timed_out'
  | 'budget_exhausted'

export interface RunHandle {
  readonly identity: RunIdentity
  readonly lifecycle: RunLifecycle
  abort(): void
}

export interface RunRegistry {
  register(
    identity: RunIdentity,
    controller: AbortController,
    steerSink?: (text: string) => boolean
  ): RunHandle
  /** Aborts only the runs of that session that were started from `chatId`. */
  abortSession(sessionId: SessionId, chatId: string): boolean
  /** Aborts every active run started from that chat, whichever session or user owns it. */
  abortChat(channel: ChannelId, chatId: string): boolean
  /** Injects text into the matching active run's next turn. False = no run accepted it. */
  steer(sessionId: SessionId, chatId: string, text: string): boolean
  drain(timeoutMs: number): Promise<void>
  active(): readonly RunHandle[]
}

export interface ToolExecutionObserver {
  start(presentation: ResolvedToolPresentation): void
  progress(message: ProgressMessage): void
  finish(display: DisplayText | undefined): void
}

export interface ToolExecutor {
  prepare(run: RunView, call: ToolCall): ToolPreparation
  execute(
    run: RunView,
    prepared: PreparedToolCall,
    observer?: ToolExecutionObserver
  ): Promise<ToolResult>
}

export interface McpToolInvoker {
  invoke(input: McpToolInvocation): Promise<ToolResult>
}

export interface McpToolInvocation {
  readonly name: string
  readonly sessionId: SessionId
  readonly input: unknown
  readonly signal?: AbortSignal
  // Absent when the client cannot prompt: the call has no approver and dangerous tools fail closed.
  readonly approval?: ToolApproval
  /** Forwarded to the transport as a progress notification. */
  readonly progress?: (message: ProgressMessage) => void
}

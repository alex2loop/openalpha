import type { LLMErrorCode, ProviderAttempt, ProviderModelId } from '@/core/llm'
import type { TokenUsage } from '@/core/stream-events'
import type { OperatorMessage } from '@/core/types/operator-message'
import type { RunResultReason } from '@/core/types/run'

export type { OperatorMessage } from '@/core/types/operator-message'

const OPERATOR_CAUSE_DEPTH = 4

export type HaltCode =
  | 'abort'
  | 'budget'
  | 'rate'
  | 'llm_error'
  | 'turn_limit'
  | 'loop'
  | 'length_limit'
  | 'content_filter'
  | 'queue_full'
  | 'session_busy'
  | 'no_agents'
  | 'hook_failed'
  | 'shutdown'
  | 'agent_paused'

export type ToolErrorCode =
  | 'unknown_tool'
  | 'unauthorized'
  | 'invalid_input'
  | 'depth_limit'
  | 'delegate_full'
  | 'budget_exhausted'
  | 'approval_timeout'
  | 'approval_denied'
  | 'approval_unavailable'
  | 'unexpected'
  | 'path_escape'
  | 'binary_content'
  | 'host_blocked'
  | 'dns_failure'
  | 'payload_too_large'
  | 'schedule_blocked'
  | 'file_not_found'
  | 'credential_leak'
  | 'timeout'
  | 'repeated_call'
  | 'server_unavailable'
  | 'superseded'

export type ChannelErrorCode =
  | 'not_initialized'
  | 'get_updates_failed'
  | 'send_failed'
  | 'edit_failed'

interface FailureTextSpec {
  readonly messageKey: string
  readonly hintKey?: string
}

interface HaltSpecEntry extends FailureTextSpec {
  readonly exitCode: number
  readonly emoji: string
}

// Which ceiling refused the call. One halt code cannot say whether the day, the month, or this run
// ran out, and the caller's next action differs for each.
export type BudgetHaltDetail =
  | 'run_budget'
  | 'daily_cap'
  | 'monthly_cap'
  | 'agent_daily_cap'
  | 'ledger_unavailable'

/** What a halt code alone cannot say. `llm_error` covers a blocked plan, bad credentials and a
 *  provider outage alike, and only the first two are pointless to retry, so the provider's own
 *  classification rides along. The two arms share no member, so a reader narrows on value. */
export type HaltDetail = BudgetHaltDetail | LLMErrorCode

export const HALT_SPEC = {
  abort: {
    exitCode: 130,
    messageKey: 'errors.abort',
    hintKey: 'errors.abortHint',
    emoji: '🛑',
  },
  budget: {
    exitCode: 3,
    messageKey: 'errors.budget',
    hintKey: 'errors.budgetHint',
    emoji: '💸',
  },
  rate: {
    exitCode: 4,
    messageKey: 'errors.rate',
    hintKey: 'errors.rateHint',
    emoji: '⏳',
  },
  llm_error: {
    exitCode: 5,
    messageKey: 'errors.llmError',
    hintKey: 'errors.llmErrorHint',
    emoji: '⚠️',
  },
  turn_limit: {
    exitCode: 6,
    messageKey: 'errors.turnLimit',
    hintKey: 'errors.turnLimitHint',
    emoji: '🔁',
  },
  loop: { exitCode: 15, messageKey: 'errors.loop', hintKey: 'errors.loopHint', emoji: '🔄' },
  length_limit: {
    exitCode: 7,
    messageKey: 'errors.lengthLimit',
    hintKey: 'errors.lengthLimitHint',
    emoji: '✂️',
  },
  content_filter: {
    exitCode: 8,
    messageKey: 'errors.contentFilter',
    hintKey: 'errors.contentFilterHint',
    emoji: '🚫',
  },
  queue_full: {
    exitCode: 9,
    messageKey: 'errors.queueFull',
    hintKey: 'errors.queueFullHint',
    emoji: '📥',
  },
  session_busy: {
    exitCode: 12,
    messageKey: 'errors.sessionBusy',
    hintKey: 'errors.sessionBusyHint',
    emoji: '🔒',
  },
  no_agents: { exitCode: 10, messageKey: 'halt.noAgents', emoji: '🤷' },
  hook_failed: { exitCode: 11, messageKey: 'halt.hookFailed', emoji: '🧩' },
  shutdown: { exitCode: 0, messageKey: 'halt.shutdown', emoji: '🌙' },
  // 13-15 belong to the CLI's channel, tool and conflict exits.
  agent_paused: { exitCode: 16, messageKey: 'halt.agentPaused', emoji: '⏸️' },
} as const satisfies Record<HaltCode, HaltSpecEntry>

// Halt details worded apart from their halt code: which ceiling refused a budget halt, or the
// provider classification that changes what the operator does next. Any other detail reads as
// its halt code.
const HALT_DETAIL_SPEC = {
  run_budget: { messageKey: 'errors.budgetRun', hintKey: 'errors.budgetRunHint' },
  daily_cap: { messageKey: 'errors.budgetDaily', hintKey: 'errors.budgetDailyHint' },
  monthly_cap: { messageKey: 'errors.budgetMonthly', hintKey: 'errors.budgetMonthlyHint' },
  agent_daily_cap: {
    messageKey: 'errors.budgetAgentDaily',
    hintKey: 'errors.budgetAgentDailyHint',
  },
  ledger_unavailable: {
    messageKey: 'errors.budgetLedger',
    hintKey: 'errors.budgetLedgerHint',
  },
  auth: { messageKey: 'errors.llmAuth', hintKey: 'errors.llmAuthHint' },
  billing: { messageKey: 'errors.llmBilling', hintKey: 'errors.llmBillingHint' },
  not_found: { messageKey: 'errors.llmNotFound', hintKey: 'errors.llmNotFoundHint' },
  rate: HALT_SPEC.rate,
} as const satisfies Partial<Record<HaltDetail, FailureTextSpec>>

type WordedHaltDetail = keyof typeof HALT_DETAIL_SPEC

/** The localized text a halted run reads as: its detail's wording where the detail has one, else
 *  its halt code's. Absent where the run carries neither, and the caller falls back to the broad
 *  `RUN_FAILURE_SPEC` entry for its reason. */
export function failureSpecOf(result: {
  readonly haltCode?: HaltCode
  readonly haltDetail?: HaltDetail
}): (typeof HALT_DETAIL_SPEC)[WordedHaltDetail] | (typeof HALT_SPEC)[HaltCode] | undefined {
  if (result.haltDetail !== undefined && isWordedHaltDetail(result.haltDetail)) {
    return HALT_DETAIL_SPEC[result.haltDetail]
  }

  return result.haltCode === undefined ? undefined : HALT_SPEC[result.haltCode]
}

function isWordedHaltDetail(detail: HaltDetail): detail is WordedHaltDetail {
  return Object.hasOwn(HALT_DETAIL_SPEC, detail)
}

// Broad non-completed run reasons mapped to the same message/hint entries where the semantics
// match; a typed halt code (RunResult.haltCode) selects HALT_SPEC instead and is preferred.
export const RUN_FAILURE_SPEC = {
  aborted: HALT_SPEC.abort,
  budget: HALT_SPEC.budget,
  turn_limit: HALT_SPEC.turn_limit,
  loop: HALT_SPEC.loop,
  timeout: {
    messageKey: 'errors.durationLimit',
    hintKey: 'errors.durationLimitHint',
  },
  error: {
    messageKey: 'errors.unexpected',
    hintKey: 'errors.unexpectedHint',
  },
} as const satisfies Record<Exclude<RunResultReason, 'completed'>, FailureTextSpec>

export abstract class AppError extends Error {
  abstract readonly code: string
  constructor(
    message: string,
    override readonly cause?: unknown
  ) {
    super(message)
    this.name = new.target.name
  }
}

interface LLMErrorOptions {
  readonly cause?: unknown
  readonly providerModel?: ProviderModelId
  readonly attemptId?: number
  readonly usage?: TokenUsage
  readonly usageSource?: 'provider' | 'estimated'
  readonly attempts?: readonly ProviderAttempt[]
  readonly retryAfterMs?: number
  readonly fallbackAllowed?: boolean
  /** The stream showed the user content before failing; the chain must not silently fall back. */
  readonly interruptedVisibleOutput?: boolean
  readonly latencyMs?: number
  readonly answeredByProvider?: boolean
}

interface AttemptUsageFailure {
  readonly error: Error
  readonly usage: TokenUsage
  readonly usageSource: 'provider' | 'estimated'
}

interface LLMErrorCloneInput {
  readonly usage?: TokenUsage
  readonly usageSource?: 'provider' | 'estimated'
  readonly attempts?: readonly ProviderAttempt[]
  readonly interruptedVisibleOutput?: true
}

export class RunHalted extends AppError {
  constructor(
    readonly code: HaltCode,
    message: string,
    readonly detail?: HaltDetail
  ) {
    super(message)
  }
}

export class LLMError extends AppError {
  readonly providerModel: ProviderModelId | undefined
  readonly attemptId: number | undefined
  readonly usage: TokenUsage | undefined
  readonly usageSource: 'provider' | 'estimated' | undefined
  readonly attempts: readonly ProviderAttempt[]
  readonly retryAfterMs: number | undefined
  readonly fallbackAllowed: boolean
  readonly interruptedVisibleOutput: boolean
  readonly latencyMs: number | undefined
  readonly answeredByProvider: boolean

  constructor(
    readonly code: LLMErrorCode,
    message: string,
    options?: LLMErrorOptions
  ) {
    super(message, options?.cause)
    this.providerModel = options?.providerModel
    this.attemptId = options?.attemptId
    this.usage = options?.usage
    this.usageSource = options?.usageSource
    this.attempts = options?.attempts ?? []
    this.retryAfterMs = options?.retryAfterMs
    this.fallbackAllowed = options?.fallbackAllowed ?? false
    this.interruptedVisibleOutput = options?.interruptedVisibleOutput ?? false
    this.latencyMs = options?.latencyMs
    this.answeredByProvider = options?.answeredByProvider ?? false
  }
}

class AttemptUsageAttached extends AppError {
  readonly code = 'attempt_usage' as const

  constructor(
    readonly error: Error,
    readonly usage: TokenUsage,
    readonly usageSource: 'provider' | 'estimated'
  ) {
    super(error.message, error)
  }
}

export function attachAttemptUsage(
  error: Error,
  input: { readonly usage: TokenUsage; readonly usageSource: 'provider' | 'estimated' }
): Error {
  return error instanceof LLMError
    ? cloneLLMError(error, input)
    : new AttemptUsageAttached(error, input.usage, input.usageSource)
}

export function attemptUsageOf(err: unknown): AttemptUsageFailure | undefined {
  if (err instanceof AttemptUsageAttached) {
    return { error: err.error, usage: err.usage, usageSource: err.usageSource }
  }

  if (err instanceof LLMError && err.usage !== undefined && err.usageSource !== undefined) {
    return { error: err, usage: err.usage, usageSource: err.usageSource }
  }

  return undefined
}

export function attachProviderAttempts(
  err: unknown,
  attempts: readonly ProviderAttempt[]
): unknown {
  if (!(err instanceof LLMError) || attempts.length === 0) {
    return err
  }

  return cloneLLMError(err, { attempts })
}

function cloneLLMError(err: LLMError, input: LLMErrorCloneInput): LLMError {
  const usage = input.usage ?? err.usage
  const usageSource = input.usageSource ?? err.usageSource

  return new LLMError(err.code, err.message, {
    cause: err,
    ...(err.providerModel === undefined ? {} : { providerModel: err.providerModel }),
    ...(err.attemptId === undefined ? {} : { attemptId: err.attemptId }),
    ...(usage === undefined ? {} : { usage }),
    ...(usageSource === undefined ? {} : { usageSource }),
    attempts: input.attempts ?? err.attempts,
    ...(err.retryAfterMs === undefined ? {} : { retryAfterMs: err.retryAfterMs }),
    ...(err.fallbackAllowed ? { fallbackAllowed: true } : {}),
    ...(input.interruptedVisibleOutput === true || err.interruptedVisibleOutput
      ? { interruptedVisibleOutput: true }
      : {}),
    ...(err.latencyMs === undefined ? {} : { latencyMs: err.latencyMs }),
    ...(err.answeredByProvider ? { answeredByProvider: true } : {}),
  })
}

// The chain states a fact the engine acts on: this failure would have fallen back, but streamed
// output had already reached the user. The engine may restart the turn; the chain may not.
export function markInterruptedVisibleOutput(err: LLMError): LLMError {
  return cloneLLMError(err, { interruptedVisibleOutput: true })
}

export class ToolError extends AppError {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message, cause)
  }
}

export class ConfigError extends AppError {
  readonly code = 'config' as const
  readonly path: readonly (string | number)[]
  readonly operator?: OperatorMessage

  constructor(message: string, cause?: unknown, path: readonly (string | number)[] = []) {
    super(message, cause)
    this.path = path
  }
}

export class StorageError extends AppError {
  readonly code = 'storage' as const
}

interface ChannelErrorOptions {
  readonly cause?: unknown
  /** Server-supplied backoff hint (HTTP 429). Surfaced here; the caller decides whether to honour it. */
  readonly retryAfterMs?: number
}

export class ChannelError extends AppError {
  readonly retryAfterMs: number | undefined

  constructor(
    readonly code: ChannelErrorCode,
    message: string,
    options?: ChannelErrorOptions
  ) {
    super(message, options?.cause)
    this.retryAfterMs = options?.retryAfterMs
  }
}

export class ValidationError extends AppError {
  readonly code = 'validation' as const
  readonly operator: OperatorMessage | undefined

  constructor(message: string, operator?: OperatorMessage, cause?: unknown) {
    super(message, cause)
    this.operator = operator
  }
}

/** A compare-and-set that lost, or a request identity reused with different content. Distinct from
 *  `ValidationError` because the request was well-formed — the caller simply raced or replayed —
 *  and the two map to different statuses at the wire boundary. */
export class ConflictError extends AppError {
  readonly code = 'conflict' as const
}

/** The operator's wording for a failure, found through the causes a wrapper adds. */
export function operatorMessageOf(err: unknown, depth = 0): OperatorMessage | undefined {
  if (!(err instanceof Error) || depth >= OPERATOR_CAUSE_DEPTH) {
    return undefined
  }

  const own =
    err instanceof ValidationError || err instanceof ConfigError ? err.operator : undefined

  return own ?? operatorMessageOf(err.cause, depth + 1)
}

/** Whether the operator's own request was refused. A refusal reads the same after waiting, so a
 *  surface that advises a retry for one is telling them to do something pointless. */
export function isCallerFault(err: unknown): boolean {
  return (
    err instanceof ValidationError || err instanceof ConfigError || err instanceof ConflictError
  )
}

export function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortError(signal)
  }
}

// The one abort-to-Error mapping: propagate the caller's abort reason when it is a real
// Error (custom reasons survive); otherwise fall back to the canonical run-halt.
export function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new RunHalted('abort', 'aborted')
}

// The DOM abort a signal raises, not the domain halt: `RunHalted('abort')` is a separate concept.
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError'
}

export function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

import type { HaltCode, HaltDetail, OperatorMessage } from '@/core/errors'
import type { LLMMessage } from '@/core/llm'
import type { RunCompletionCode, RunResultReason } from '@/core/types/run'
import type {
  AfterRunHook,
  RunLifecycle,
  RunResult,
  RunResultLimits,
  RunState,
  RunView,
} from '@/engine/types/run'
import { missingEnvOf } from '@/core/config/resolve'
import { operatorMessageOf, RunHalted } from '@/core/errors'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { textOf, toolCallIdsOf } from '@/core/utils/message'
import { toolResultMessage } from '@/engine/loop/turn'
import { isCriticalHook } from '@/engine/types/run'

// The stable caller-facing reason derived from a halt code. The halt code itself is preserved on
// RunResult.haltCode for typed display; errorMessage carries scrubbed diagnostic detail only.
export const HALT_CODE_TO_REASON: Readonly<Record<HaltCode, RunResultReason>> = {
  abort: 'aborted',
  budget: 'budget',
  rate: 'error',
  llm_error: 'error',
  turn_limit: 'turn_limit',
  loop: 'loop',
  length_limit: 'error',
  content_filter: 'error',
  queue_full: 'error',
  session_busy: 'error',
  no_agents: 'error',
  hook_failed: 'error',
  shutdown: 'aborted',
  agent_paused: 'error',
}

export const RUN_REASON_TO_LIFECYCLE: Readonly<Record<RunResultReason, RunLifecycle>> = {
  completed: 'done',
  aborted: 'aborted',
  budget: 'budget_exhausted',
  timeout: 'timed_out',
  turn_limit: 'failed',
  loop: 'failed',
  error: 'failed',
}

// A halted tool may have completed its side effects before the run ended. Without this the next
// run reads the synthetic failure as "nothing happened" and re-issues the call.
const INTERRUPTED_TURN_NOTE =
  'The previous turn was interrupted. Any tool that had started may have partially executed; verify before repeating it.'

export interface CaughtVerdict {
  readonly reason: RunResultReason
  readonly haltCode?: HaltCode
  readonly haltDetail?: HaltDetail
  readonly errorMessage?: string
  readonly operator?: OperatorMessage
  readonly missingEnv?: string
}

interface BuildRunResultOptions {
  readonly workStarted: boolean
  readonly limits?: RunResultLimits
  readonly haltCode?: HaltCode
  readonly haltDetail?: HaltDetail
  readonly errorMessage?: string
  readonly operator?: OperatorMessage
  readonly missingEnv?: string
  readonly completionCode?: RunCompletionCode
  readonly model?: string
}

// A dangling tool_call with no matching tool result makes the next provider request invalid,
// so a run that halts mid-tool-call must synthesize the missing answers before it exits.
function completePendingToolCalls(state: RunState, reason: RunResultReason): void {
  const history = state.messages.history
  const lastCallIndex = findLastToolCallIndex(history)

  if (lastCallIndex < 0) {
    return
  }

  const answered = new Set<string>()

  for (let i = lastCallIndex + 1; i < history.length; i++) {
    const msg = history[i]

    if (msg?.role === 'tool' && msg.toolCallId !== undefined) {
      answered.add(msg.toolCallId)
    }
  }

  let synthesized = 0

  for (const id of toolCallIdsOf(history[lastCallIndex])) {
    if (answered.has(id)) {
      continue
    }

    state.messages.appendDirect(
      toolResultMessage(id, {
        content: `Run halted (${reason}) before tool completed`,
        isError: true,
      })
    )
    synthesized += 1
  }

  if (synthesized > 0) {
    state.messages.appendDirect({ role: 'user', content: INTERRUPTED_TURN_NOTE })
  }
}

export function buildRunResult(
  state: RunState,
  reason: RunResultReason,
  options: BuildRunResultOptions
): RunResult {
  return {
    reason,
    text: textOf(state.messages.latestAssistant?.content ?? ''),
    totals: state.totals,
    runCostUsd: state.totals.costUsd - state.priorCostUsd,
    workStarted: options.workStarted,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    ...(options.haltCode === undefined ? {} : { haltCode: options.haltCode }),
    ...(options.haltDetail === undefined ? {} : { haltDetail: options.haltDetail }),
    ...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
    ...(options.operator === undefined ? {} : { operator: options.operator }),
    ...(options.missingEnv === undefined ? {} : { missingEnv: options.missingEnv }),
    ...(options.completionCode === undefined ? {} : { completionCode: options.completionCode }),
    ...(options.model === undefined ? {} : { model: options.model }),
  }
}

/** What a failure carries for the operator: their sentence and the unset key behind it. */
export function operatorFieldsOf(
  verdict: CaughtVerdict
): Pick<CaughtVerdict, 'operator' | 'missingEnv'> {
  return {
    ...(verdict.operator === undefined ? {} : { operator: verdict.operator }),
    ...(verdict.missingEnv === undefined ? {} : { missingEnv: verdict.missingEnv }),
  }
}

export function classifyCaught(
  err: unknown,
  run: RunView,
  timeoutSentinel: unknown
): CaughtVerdict {
  const abortReason: RunResultReason =
    run.state.abort.signal.reason === timeoutSentinel ? 'timeout' : 'aborted'

  if (err instanceof RunHalted) {
    // A deadline abort carries the timeout reason, not the generic abort code, so it cannot be
    // rendered as user cancellation: no haltCode is attached for abort.
    if (err.code === 'abort') {
      return { reason: abortReason }
    }

    return {
      reason: HALT_CODE_TO_REASON[err.code],
      haltCode: err.code,
      ...(err.detail === undefined ? {} : { haltDetail: err.detail }),
      errorMessage: `${err.code}: ${scrubCredentials(err.message)}`,
    }
  }

  if (run.state.abort.signal.aborted) {
    return { reason: abortReason }
  }

  const formatted = formatErrForLog(err)
  const operator = operatorMessageOf(err)
  const missingEnv = missingEnvOf(err)?.env
  // One the operator can fix (an unset key, a refused one) is not a fault in the code.
  const level = operator === undefined && missingEnv === undefined ? 'error' : 'warn'
  run.services.logger[level]('engine.run_uncaught', { err: formatted })

  return {
    reason: 'error',
    errorMessage: formatted.message,
    ...(operator === undefined ? {} : { operator }),
    ...(missingEnv === undefined ? {} : { missingEnv }),
  }
}

// Cleanup never throws: a failure here would mask whatever halted the run.
export async function runFinally(
  run: RunView,
  result: RunResult,
  afterRun: readonly AfterRunHook[]
): Promise<RunResult> {
  let finalResult = result

  try {
    run.state.messages.flushPending()
  } catch (err: unknown) {
    run.services.logger.error('engine.flush_failed', { err: formatErrForLog(err) })
  }

  if (result.reason !== 'completed') {
    try {
      completePendingToolCalls(run.state, result.reason)
    } catch (err: unknown) {
      run.services.logger.error('engine.synth_tool_results_failed', { err: formatErrForLog(err) })
    }
  }

  for (const hook of afterRun) {
    try {
      await hook(run, finalResult)
    } catch (err: unknown) {
      if (isCriticalHook(hook)) {
        const formatted = formatErrForLog(err)

        run.services.logger.error('engine.critical_hook_failed', { err: formatted })
        finalResult = {
          ...finalResult,
          reason: 'error',
          haltCode: 'hook_failed',
          errorMessage: `hook_failed: critical hook failed: ${formatted.message}`,
        }
        continue
      }

      run.services.logger.warn('engine.after_run_hook_threw', { err: formatErrForLog(err) })
    }
  }

  return finalResult
}

function findLastToolCallIndex(history: readonly LLMMessage[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (toolCallIdsOf(history[i]).length > 0) {
      return i
    }
  }

  return -1
}

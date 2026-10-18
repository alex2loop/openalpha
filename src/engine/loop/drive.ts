import type { ChannelId } from '@/core/channels'
import type { SessionId } from '@/core/ids'
import type { ContentBlock, ProviderResponse } from '@/core/llm'
import type { OnStreamEvent } from '@/core/stream-events'
import type { ToolCall } from '@/core/tool'
import type { RunCompletionCode } from '@/core/types/run'
import type { RunBookkeeping } from '@/engine/loop/context'
import type { RunHandle, RunLifecycle, RunResult, RunView } from '@/engine/types/run'
import type { RunOnceDeps } from '@/engine/types/run-deps'
import { RunHalted } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { MAX_VISIBLE_OUTPUT_RESTARTS } from '@/engine/constants'
import {
  buildRunResult,
  type CaughtVerdict,
  classifyCaught,
  operatorFieldsOf,
  RUN_REASON_TO_LIFECYCLE,
  runFinally,
} from '@/engine/loop/finalize'
import { runAfterLLM, runHooks } from '@/engine/loop/hook-runner'
import { assertRunTurnAllowed } from '@/engine/loop/preflight'
import { callProvider } from '@/engine/loop/provider-call'
import { compactOnce, isCompactionNeeded, shrinkContextWindow } from '@/engine/loop/run-compaction'
import { emitTurnMetric, runStreamListener } from '@/engine/loop/run-logging'
import { restoreTodoList } from '@/engine/loop/todo'
import { classifyFinishReason, commitTurn, executeTools } from '@/engine/loop/turn'
import { clampUserMessage } from '@/engine/loop/user-message'
import { TIMEOUT_ABORT } from '@/engine/run-registry'

declare module '@/core/events' {
  interface BusEventMap {
    // channel/chatId route the notice back to the human whose messages were dropped; a run with
    // no chat (cli, scheduler) carries neither.
    steering_dropped: {
      readonly sessionId: SessionId
      readonly channel: ChannelId
      readonly chatId?: string
      readonly count: number
    }
  }
}

const TOOL_CALL_ENVELOPE_RE = /<(?:function_calls|tool_call|arg_key)/

interface DriveDeps {
  readonly deps: RunOnceDeps
  readonly handle: RunHandle
  readonly dispose: () => void
  readonly onChunk: OnStreamEvent | undefined
  readonly onWorkStart: (() => Promise<void>) | undefined
  readonly steering: SteeringInbox
  readonly progress: { workStarted: boolean }
}

interface SteeringInbox {
  /** Accepts text while the run's turn loop is open; false once the loop has exited. */
  readonly accept: (text: string) => boolean
  readonly queue: string[]
  hasPending(): boolean
  close(): void
}

// Single-threaded discipline: accept() runs on other microtasks; there is no await between the
// loop's final queue check and close(), so a message is either drained or refused - never lost.
export function createSteeringInbox(): SteeringInbox {
  const queue: string[] = []
  let open = true

  return {
    queue,
    accept: (text: string): boolean => {
      if (!open) {
        return false
      }

      queue.push(text)
      return true
    },
    hasPending: (): boolean => queue.length > 0,
    close: (): void => {
      open = false
    },
  }
}

// Steering accepted but never drained ends here. The engine cannot re-enqueue a channel message
// itself, so it announces the drop and the surface tells the operator to resend.
function closeSteering(run: RunView, steering: SteeringInbox): void {
  steering.close()

  const dropped = steering.queue.splice(0)

  if (dropped.length === 0) {
    return
  }

  run.services.bus.emit('steering_dropped', {
    sessionId: run.identity.sessionId,
    channel: run.identity.channel,
    ...(run.identity.chatId === undefined ? {} : { chatId: run.identity.chatId }),
    count: dropped.length,
  })
}

// Loop-internal scope. Not a RunContext: it carries no identity/env/state of its own, it just
// saves re-threading the same three locals through every step of one turn.
interface TurnScope {
  readonly run: RunView
  readonly bookkeeping: RunBookkeeping
  readonly drive: DriveDeps
}

export async function driveRun(scope: TurnScope): Promise<RunResult> {
  const { run, drive } = scope
  const { deps, handle } = drive
  let caught: CaughtVerdict = { reason: 'error', errorMessage: 'runOnce did not set a reason' }
  let completionCode: RunCompletionCode | undefined
  // Settled in `finally`: an entry left behind holds its abort controller forever, reports a
  // phantom run to `active()`, and stalls `drain()` for its whole timeout.
  let lifecycle: RunLifecycle = 'failed'

  try {
    try {
      await runHooks(deps.hooks.beforeRun, run)

      while (true) {
        const outcome = await runOneTurn(scope)

        if (outcome === 'continue') {
          continue
        }

        // A message that arrived while the final turn streamed re-opens the loop instead of
        // spawning a follow-up run.
        if (outcome === 'done' && drive.steering.hasPending()) {
          continue
        }

        if (outcome !== 'done') {
          completionCode = outcome
        }

        break
      }

      closeSteering(run, drive.steering)

      caught = { reason: 'completed' }
    } catch (err: unknown) {
      closeSteering(run, drive.steering)
      caught = classifyCaught(err, run, TIMEOUT_ABORT)
    }

    caught = await runBeforeFinalize(scope, completionCode, caught)

    const result = buildRunResult(run.state, caught.reason, {
      workStarted: drive.progress.workStarted,
      model: run.env.agent.model,
      limits: {
        maxTurns: run.env.limits.maxTurns,
        maxToolCalls: run.env.limits.maxToolCalls,
        maxDurationMs: run.env.limits.maxDurationMs,
      },
      ...(caught.haltCode === undefined ? {} : { haltCode: caught.haltCode }),
      ...(caught.haltDetail === undefined ? {} : { haltDetail: caught.haltDetail }),
      ...(caught.errorMessage === undefined ? {} : { errorMessage: caught.errorMessage }),
      ...operatorFieldsOf(caught),
      ...(completionCode === undefined ? {} : { completionCode }),
    })

    // Finalize before markDone so persistence settles and any critical failure changes the
    // lifecycle before drain() can resolve.
    const finalResult = await runFinally(run, result, deps.hooks.afterRun)

    lifecycle = RUN_REASON_TO_LIFECYCLE[finalResult.reason]

    return finalResult
  } finally {
    deps.registry.markDone(handle.identity.runId, lifecycle)
  }
}

// Runs before-finalize and tears down the run's abort composition. A failure here overrides only a
// completed result; a run that already failed keeps its own typed outcome, and the secondary
// failure is logged rather than masking the original.
async function runBeforeFinalize(
  scope: TurnScope,
  completionCode: RunCompletionCode | undefined,
  caught: CaughtVerdict
): Promise<CaughtVerdict> {
  const { run, drive } = scope

  try {
    if (drive.progress.workStarted && completionCode === undefined) {
      await runHooks(drive.deps.hooks.beforeFinalize, run)
    }
  } catch (err: unknown) {
    if (caught.reason !== 'completed') {
      run.services.logger.warn('engine.before_finalize_failed', {
        reason: caught.reason,
        err: formatErrForLog(err),
      })
    } else {
      return classifyCaught(err, run, TIMEOUT_ABORT)
    }
  } finally {
    drive.dispose()
  }

  return caught
}

async function runOneTurn(scope: TurnScope): Promise<TurnResult> {
  const { run, bookkeeping, drive } = scope
  const { deps } = drive

  assertRunTurnAllowed(run)
  drainSteering(run, drive.steering)
  await runHooks(deps.hooks.beforeLLM, run)

  if (!drive.progress.workStarted) {
    await drive.onWorkStart?.()
    drive.progress.workStarted = true
  }

  if (isCompactionNeeded(run, bookkeeping)) {
    await compactOnce(scope.run, scope.bookkeeping, scope.drive.deps.compactor)
    return 'continue'
  }

  restoreTodoList(run)

  const startedAt = performance.now()
  const settled = await callProvider({
    run,
    chain: run.services.chain,
    hooks: deps.hooks,
    onChunk: drive.onChunk,
    consumeTurnRestart: () => {
      if (bookkeeping.turnRestarts >= MAX_VISIBLE_OUTPUT_RESTARTS) {
        return false
      }

      bookkeeping.turnRestarts += 1
      return true
    },
    recoverContextOverflow: async () => {
      shrinkContextWindow(run)
      await compactOnce(scope.run, scope.bookkeeping, scope.drive.deps.compactor)
    },
  })

  if (settled === undefined) {
    return 'continue'
  }

  const latencyMs = performance.now() - startedAt

  commitTurn(run.state, bookkeeping, {
    runId: run.identity.runId,
    response: settled.response,
    llmAttemptIds: settled.llmAttemptIds,
  })
  emitTurnMetric({
    run,
    estimator: bookkeeping.estimator,
    onChunk: drive.onChunk,
    settled,
    latencyMs,
  })
  await runAfterLLM(deps.hooks.afterLLM, run, settled.response)

  return await dispatchTurn(scope, settled.response)
}

// Steered messages enter as ordinary user messages at a turn boundary, where the transcript has
// no dangling tool pairs, and land in the durable trail via the same appendDirect path as the
// run's opening message.
function drainSteering(run: RunView, steering: SteeringInbox): void {
  const drained = steering.queue.splice(0)

  if (drained.length === 0) {
    return
  }

  for (const text of drained) {
    run.state.messages.appendDirect({ role: 'user', content: clampUserMessage(text) })
  }

  run.services.logger.info('engine.steering_injected', { count: drained.length })
}

type TurnResult = 'continue' | 'done' | RunCompletionCode

async function dispatchTurn(scope: TurnScope, response: ProviderResponse): Promise<TurnResult> {
  const { run, drive } = scope
  const { deps } = drive
  const verdict = classifyFinishReason(run.state, response)

  if (verdict === 'halt') {
    throw new RunHalted('content_filter', 'provider blocked response')
  }

  if (verdict === 'compact') {
    await compactOnce(scope.run, scope.bookkeeping, scope.drive.deps.compactor)
    return 'continue'
  }

  // A `pause_turn` is a continuation marker, not a final answer: keep the partial assistant
  // message and let the next turn resume without running tools.
  if (response.finishReason === 'pause') {
    run.state.messages.flushPending()
    return 'continue'
  }

  const calls = toolCallsOf(response.content)

  if (calls.length === 0) {
    run.state.messages.flushPending()
    await runHooks(deps.hooks.afterTurn, run)

    if (hasToolCallEnvelope(response.content)) {
      run.services.logger.warn('engine.model_tool_call_as_text', { model: run.env.agent.model })
      return 'model_tool_call_as_text'
    }

    return 'done'
  }

  const onEvent = runStreamListener(drive.onChunk, run.services.logger)

  const completionCode = await executeTools(run, calls, {
    admissionGates: deps.hooks.toolAdmission,
    approvalGate: deps.hooks.approvalGate,
    executor: deps.executor,
    afterTool: deps.hooks.afterTool,
    hasPendingSteering: () => drive.steering.hasPending(),
    ...(onEvent === undefined ? {} : { onEvent }),
  })
  await runHooks(deps.hooks.afterTurn, run)

  return completionCode ?? 'continue'
}

function toolCallsOf(content: readonly ContentBlock[]): readonly ToolCall[] {
  return content.filter((block) => block.type === 'tool_call').map((block) => block.call)
}

function hasToolCallEnvelope(content: readonly ContentBlock[]): boolean {
  return content.some((block) => block.type === 'text' && TOOL_CALL_ENVELOPE_RE.test(block.text))
}

import type { LLMAttemptId, RunId } from '@/core/ids'
import type { LLMMessage, LLMResponse, ProviderResponse } from '@/core/llm'
import type { DisplayText, OnStreamEvent, ToolLifecycleOwner } from '@/core/stream-events'
import type { ToolCall, ToolResult } from '@/core/tool'
import type { RunCompletionCode } from '@/core/types/run'
import type { RunBookkeeping } from '@/engine/loop/context'
import type { ToolEventTracker } from '@/engine/loop/tool-events'
import type {
  AfterToolHook,
  ApprovalGate,
  PreparedToolCall,
  RunState,
  RunView,
  ToolExecutionObserver,
  ToolExecutor,
  ToolGate,
} from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { formatErrForLog, isSensitiveKey, scrubCredentials } from '@/core/security/credentials'
import { unwrapToolResult } from '@/core/security/sanitize'
import { textOf } from '@/core/utils/message'
import { normalizeUsage } from '@/engine/budget/attempt-settlement'
import { loopDetectorGate } from '@/engine/hooks/loop-detector'
import { createToolEventTracker } from '@/engine/loop/tool-events'
import {
  createToolExposureGate,
  TOOL_SEARCH_NAME,
  TOOL_SEARCH_PRESENTATION,
  toolSearchGist,
} from '@/engine/loop/tools/exposure'
import { blockFromGates } from '@/engine/loop/tools/gates'
import { createToolObserver } from '@/engine/loop/tools/observer'
import { resolveToolResultDisplay } from '@/engine/loop/tools/presentation'

const TOOL_EVENT_SUMMARY_MAX_CHARS = 240
const SERIALIZATION_FAILURE_SUMMARY = '[unavailable]'

// Model-facing content for tool calls that never ran. Each must stay paired in the transcript so
// the next provider request is well-formed, but no call executes.
const APPROVAL_TIMEOUT_SKIPPED_RESULT: ToolResult = {
  content: 'Tool was not run because an earlier approval request timed out.',
  isError: true,
  errorCode: 'approval_timeout',
}
const STEERING_SKIPPED_RESULT: ToolResult = {
  content: 'Tool was not run because a new user message arrived. Read it before continuing.',
  isError: true,
  errorCode: 'superseded',
}

interface TurnCommit {
  readonly runId: RunId
  readonly response: ProviderResponse
  readonly llmAttemptIds: readonly [LLMAttemptId, ...LLMAttemptId[]]
}

export type SettledTurn = Pick<TurnCommit, 'response' | 'llmAttemptIds'>

interface ToolRunDeps {
  readonly admissionGates: readonly ToolGate[]
  readonly approvalGate: ApprovalGate
  readonly executor: ToolExecutor
  readonly afterTool: readonly AfterToolHook[]
  readonly hasPendingSteering?: () => boolean
  readonly onEvent?: OnStreamEvent
  readonly observer?: ToolExecutionObserver
  readonly events?: ToolEventTracker
}

interface AgentToolCallOptions {
  readonly run: RunView
  readonly call: ToolCall
  readonly deps: ToolRunDeps
}

export function toolResultMessage(
  id: string,
  result: ToolResult
): LLMMessage & { readonly role: 'tool' } {
  return {
    role: 'tool',
    toolCallId: id,
    content: result.content,
    isError: result.isError,
  }
}

// Single-ledger rule: usage/cost facts were settled per attempt already; this records the turn
// count, refreshes the prompt-size estimator, and queues the assistant write with its attempts.
export function commitTurn(state: RunState, bookkeeping: RunBookkeeping, commit: TurnCommit): void {
  const usage = normalizeUsage(commit.response.usage)

  adjustTurnCount(state, 1)
  bookkeeping.estimator = {
    tokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
  }
  state.messages.pushToPending(assistantMessage(commit.response), commit.llmAttemptIds)
}

export function classifyFinishReason(
  state: RunState,
  response: LLMResponse
): 'continue' | 'compact' | 'halt' {
  switch (response.finishReason) {
    case 'length':
      // A truncated generation is retried after compaction: drop its half-built assistant
      // message and un-count the turn so it never eats into maxTurns. Its attempts stay
      // durably billed, unlinked to any transcript row.
      state.messages.clearPending()
      adjustTurnCount(state, -1)
      return 'compact'

    case 'content_filter':
      state.messages.flushPending()
      return 'halt'

    case 'stop':
    case 'tool_use':
      return 'continue'

    case 'pause':
      // Anthropic's `pause_turn` means the model stopped mid-turn; keep the partial assistant
      // message in history and continue rather than presenting a clean final answer.
      return 'continue'

    default:
      return unreachableFinishReason(response.finishReason)
  }
}

// A cut-off answer the run could not compact its way past is still the best answer it has: the
// halt keeps its code and the operator reads the partial text instead of nothing.
export function keepPartialAnswer(state: RunState, settled: SettledTurn): void {
  const { response } = settled
  const hasCalls = response.content.some((block) => block.type === 'tool_call')

  if (hasCalls || textOf(response.content).trim() === '') {
    return
  }

  state.messages.pushToPending(assistantMessage(response), settled.llmAttemptIds)
  state.messages.flushPending()
}

export async function executeTools(
  run: RunView,
  calls: readonly ToolCall[],
  deps: ToolRunDeps
): Promise<RunCompletionCode | undefined> {
  run.state.messages.flushPending()

  const admissionGates = [...deps.admissionGates, createToolExposureGate(run.state.toolExposure)]
  const agentDeps: ToolRunDeps = { ...deps, admissionGates }

  for (let index = 0; index < calls.length; index++) {
    const call = calls[index]

    if (call === undefined) {
      break
    }

    // A steer waiting is a newer instruction than this batch: pair the rest so the transcript
    // stays well-formed and let the next turn deliver it before any further tool runs.
    if (deps.hasPendingSteering?.() === true) {
      recordSkippedToolCalls({
        run,
        calls: calls.slice(index),
        result: STEERING_SKIPPED_RESULT,
        deps,
      })

      return undefined
    }

    const result = await runOneToolCall(run, call, agentDeps)

    if (result.errorCode === 'approval_timeout') {
      recordSkippedToolCalls({
        run,
        calls: calls.slice(index + 1),
        result: APPROVAL_TIMEOUT_SKIPPED_RESULT,
        deps,
      })

      return 'approval_timeout'
    }
  }

  return undefined
}

// Runs one call under its own stream observer and records the result. The observer exists only
// when the caller is streaming, and it owns the tool's display text for that call.
async function runOneToolCall(
  run: RunView,
  call: ToolCall,
  deps: ToolRunDeps
): Promise<ToolResult> {
  const { onEvent } = deps
  const tracked =
    onEvent === undefined ? undefined : createToolObserver(run.services.logger, onEvent, call)
  const events = createToolEventTracker(run, call)
  const callDeps = {
    ...deps,
    events,
    ...(tracked === undefined ? {} : { observer: tracked.observer }),
  }
  const result = await executeAgentTool({ run, call, deps: callDeps })

  recordToolResult({
    run,
    call,
    result,
    events,
    lifecycleOwner: tracked?.lifecycleOwner ?? 'tool',
    ...(onEvent === undefined ? {} : { onEvent }),
    ...(tracked?.display === undefined ? {} : { display: tracked.display }),
  })

  return result
}

interface RecordToolResultInput {
  readonly run: RunView
  readonly call: ToolCall
  readonly result: ToolResult
  readonly events: ToolEventTracker
  readonly lifecycleOwner: ToolLifecycleOwner
  readonly onEvent?: OnStreamEvent
  readonly display?: DisplayText
}

// Single owner of the transcript append + stream-event emission so normal and synthetic results
// cannot diverge. The optional display text does not enter the model transcript.
function recordToolResult(input: RecordToolResultInput): void {
  const { run, call, result, events, lifecycleOwner, onEvent, display } = input

  run.state.messages.appendDirect(toolResultMessage(call.id, result))
  onEvent?.({
    type: 'tool_result',
    id: call.id,
    name: call.name,
    ok: result.isError !== true,
    lifecycleOwner,
    ...(result.isError === true
      ? {
          error: summarizeToolValue(result.content),
          ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
        }
      : { resultSummary: summarizeToolValue(result.content) }),
    ...(display === undefined ? {} : { display }),
  })
  events.finished(result.isError !== true)
}

interface SkipToolCallsInput {
  readonly run: RunView
  readonly calls: readonly ToolCall[]
  readonly result: ToolResult
  readonly deps: ToolRunDeps
}

// Pairs every listed call with a synthetic failure so the transcript stays well-formed, without
// preparing, approving, or executing any of them.
function recordSkippedToolCalls(input: SkipToolCallsInput): void {
  const { onEvent } = input.deps

  for (const call of input.calls) {
    recordToolResult({
      run: input.run,
      call,
      result: input.result,
      events: createToolEventTracker(input.run, call),
      lifecycleOwner: 'tool',
      ...(onEvent === undefined ? {} : { onEvent }),
    })
  }
}

async function executeAgentTool(options: AgentToolCallOptions): Promise<ToolResult> {
  const { run, call, deps } = options

  if (call.name !== TOOL_SEARCH_NAME) {
    return await executeTool(run, call, deps)
  }

  assertRunActive(run)
  deps.observer?.start(TOOL_SEARCH_PRESENTATION)

  const blocked = await blockFromGates(run, call, [loopDetectorGate])

  if (blocked !== undefined) {
    deps.observer?.finish(undefined)
    return blocked
  }

  const result = run.state.toolExposure.search(call.input)
  deps.observer?.finish(result.isError ? undefined : toolSearchGist(result.content))

  return result
}

// The MCP server enters here so direct tool calls receive the same capability, approval, and
// after-tool treatment as calls emitted by the agent loop.
export async function executeTool(
  run: RunView,
  call: ToolCall,
  deps: ToolRunDeps
): Promise<ToolResult> {
  assertRunActive(run)

  const admission = await blockFromGates(run, call, deps.admissionGates)

  if (admission !== undefined) {
    return admission
  }

  const preparation = deps.executor.prepare(run, call)

  if (preparation.kind === 'rejected') {
    return finishToolCall(run, {
      call,
      result: preparation.result,
      hooks: deps.afterTool,
    })
  }

  const prepared = preparation.prepared
  const approval = await blockFromGates(run, prepared, [deps.approvalGate])

  if (approval !== undefined) {
    return approval
  }

  assertRunActive(run)

  deps.observer?.start(prepared.presentation)
  deps.events?.started()

  // A throw here or in the display step below skips recordToolResult, so these are the only signals
  // left to close out the surface's spinner and the call's bus events.
  const result = await executePreparedTool(run, prepared, deps).catch((err: unknown) => {
    deps.observer?.finish(undefined)
    deps.events?.finished(false)
    throw err
  })

  try {
    deps.observer?.finish(
      resolveToolResultDisplay({ tool: prepared.tool, result, logger: run.services.logger })
    )
  } catch (err: unknown) {
    deps.events?.finished(false)
    throw err
  }

  return finishToolCall(run, { call: prepared, result, hooks: deps.afterTool })
}

function assertRunActive(run: RunView): void {
  if (run.state.abort.signal.aborted) {
    throw new RunHalted('abort', 'run aborted')
  }
}

function executePreparedTool(
  run: RunView,
  call: PreparedToolCall,
  deps: ToolRunDeps
): Promise<ToolResult> {
  const cache = run.state.toolResultCache
  const execute = () => deps.executor.execute(run, call, deps.observer)

  return cache === undefined ? execute() : cache.getOrExecute(run, call, execute)
}

async function finishToolCall(
  run: RunView,
  input: {
    readonly call: ToolCall
    readonly result: ToolResult
    readonly hooks: readonly AfterToolHook[]
  }
): Promise<ToolResult> {
  await runAfterToolHooks(run, input.call, { result: input.result, hooks: input.hooks })
  return input.result
}

async function runAfterToolHooks(
  run: RunView,
  call: ToolCall,
  after: { readonly result: ToolResult; readonly hooks: readonly AfterToolHook[] }
): Promise<void> {
  for (const hook of after.hooks) {
    try {
      await hook(run, call, after.result)
    } catch (err: unknown) {
      run.services.logger.warn('engine.after_tool_hook_threw', {
        tool: call.name,
        err: formatErrForLog(err),
      })
    }
  }
}

// Thinking blocks ride along so the next request replays them verbatim (Anthropic rejects
// a follow-up that drops a signed thinking block).
function assistantMessage(response: LLMResponse): LLMMessage & { readonly role: 'assistant' } {
  const content = response.content.length === 0 ? '' : response.content
  return {
    role: 'assistant',
    content,
    ...(response.reasoningBlocks === undefined
      ? {}
      : { reasoningBlocks: response.reasoningBlocks }),
  }
}

function summarizeToolValue(value: unknown): string {
  const serialized = serializeToolValue(value)
  // Surfaces get the content, not the model-facing <tool_result> envelope around it.
  const oneLine = scrubCredentials(unwrapToolResult(serialized).replace(/\s+/g, ' ').trim())

  return oneLine.length > TOOL_EVENT_SUMMARY_MAX_CHARS
    ? `${oneLine.slice(0, TOOL_EVENT_SUMMARY_MAX_CHARS - 1)}…`
    : oneLine
}

function serializeToolValue(value: unknown): string {
  if (value instanceof Error) {
    return value.message
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, redactSensitiveField) ?? SERIALIZATION_FAILURE_SUMMARY
  } catch {
    return SERIALIZATION_FAILURE_SUMMARY
  }
}

function redactSensitiveField(key: string, value: unknown): unknown {
  return isSensitiveKey(key) ? '[REDACTED]' : value
}

function unreachableFinishReason(value: never): never {
  throw new RunHalted('llm_error', `unsupported finish reason: ${String(value)}`)
}

function adjustTurnCount(state: RunState, delta: number): void {
  state.turn += delta
}

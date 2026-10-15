import type { EventBus } from '@/core/events'
import type { ProgressMessage } from '@/core/stream-events'
import type { ToolCall, ToolInvocationContext, ToolResult, ToolServices } from '@/core/tool'
import type { Memory } from '@/core/types/memory'
import type { ExternalCharge } from '@/core/types/usage'
import type {
  PreparedToolCall,
  RunView,
  ToolExecutionObserver,
  ToolExecutor,
  ToolPreparation,
} from '@/engine/types/run'
import { RunHalted, ToolError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { OutputPipeline } from '@/core/security/output-pipeline'
import { settleExternalCharge } from '@/engine/budget/attempt-settlement'
import { addUsage } from '@/engine/budget/usage'
import { parseToolInput } from '@/engine/loop/tools/arg-parse'
import { resolveToolPresentation } from '@/engine/loop/tools/presentation'

const TRAILING_COMMA_RE = /,\s*([}\]])$/

// `services` is opaque here on purpose: tools/ owns what goes in it (agents, runner, its own
// interfaces), and engine must not grow an edge to tools to name those types.
interface ToolExecutorDeps {
  readonly bus: EventBus
  readonly memory: Memory
  readonly services: ToolServices
}

/** Where a formatted result goes: the bus hears its threats, and the run's cap bounds its size. */
interface ResultSink {
  readonly bus: EventBus
  readonly maxBytes: number
}

export function coerceToolArgs(args: unknown): unknown {
  if (typeof args !== 'string') {
    return args ?? {}
  }

  if (args.trim() === '') {
    return {}
  }

  try {
    return JSON.parse(args)
  } catch {
    // A streamed tool call may end with incomplete JSON when the model hits its token limit.
    const repaired = repairJson(args)

    return repaired ?? { raw: args }
  }
}

export function createToolExecutor(deps: ToolExecutorDeps): ToolExecutor {
  return {
    prepare: (run, call) => prepareToolCall(deps, run, call),

    async execute(run, prepared, observer): Promise<ToolResult> {
      const { tool } = prepared

      // The only record that a tool ran. Debug because the rate is the run's tool-call rate, and
      // without it nothing outside the model's own transcript can say which tools an agent used.
      run.services.logger.debug('tool.invoked', {
        agentId: run.identity.agentId,
        tool: tool.name,
      })

      const guard = armToolGuard(run, tool.timeoutMs)
      const sink = resultSink(deps, run)
      const context = buildInvocationContext(run, deps, {
        callId: prepared.id,
        observer,
        signal: guard.signal,
      })

      try {
        const raw = await Promise.race([tool.execute(prepared.input, context), guard.interrupt])
        const result = typeof raw === 'string' ? { content: raw, isError: false } : raw

        warnOnOutputDrift(run, prepared, result)
        return formatPipelineResult(result, prepared, sink)
      } catch (err: unknown) {
        if (err instanceof RunHalted) {
          throw err
        }

        if (err instanceof ToolError) {
          return formatResult(err, prepared, sink)
        }

        // A rejected argument is the model's to fix; only a genuine fault reads as `unexpected`.
        const code = err instanceof ValidationError ? 'invalid_input' : 'unexpected'

        return formatResult(new ToolError(code, formatErrForLog(err).message), prepared, sink)
      } finally {
        guard.dispose()
      }
    },
  }
}

type CostCallbacks = Pick<
  ToolInvocationContext,
  'addDelegatedUsage' | 'addExternalCost' | 'recordExternalCost'
>

function costCallbacks(run: RunView): CostCallbacks {
  const addRunExternalCost = (charge: ExternalCharge): Promise<void> =>
    settleExternalCharge(run, charge, Date.now())

  return {
    addDelegatedUsage: (childTotals) => {
      run.state.totals = addUsage(run.state.totals, childTotals)
    },
    addExternalCost: addRunExternalCost,
    recordExternalCost: async (charge) => {
      await addRunExternalCost(charge)
      run.state.budget.charge(charge.costUsd)
    },
  }
}

interface ToolGuard {
  readonly signal: AbortSignal
  /** Rejects with a timeout ToolError when the cap fires, or RunHalted('abort') when the run is
   *  aborted; never resolves. */
  readonly interrupt: Promise<never>
  readonly dispose: () => void
}

// Arms the timer and the run-abort listener; the executor's finally owns releasing both via
// dispose. A tool that ignores its signal after an interrupt keeps running detached - the settled
// race absorbs its late outcome.
// A tool declaring no timeout still gets one, bounded by the run's duration cap: racing a
// never-settling promise instead lets a hung tool outlive `maxDurationMs` and never settle the run.
function armToolGuard(run: RunView, timeoutMs: number | undefined): ToolGuard {
  const runSignal = run.state.abort.signal
  const capMs = timeoutMs ?? run.env.limits.toolTimeoutMs
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const interrupt = new Promise<never>((_, reject) => {
    onAbort = (): void => reject(new RunHalted('abort', 'run aborted'))

    if (runSignal.aborted) {
      onAbort()
      return
    }

    timer = setTimeout(() => {
      controller.abort()
      reject(new ToolError('timeout', `tool timed out after ${capMs}ms`))
    }, capMs).unref()
    runSignal.addEventListener('abort', onAbort, { once: true })
  })

  // The tool usually wins the race and nothing ever awaits `interrupt`, so an unattached rejection
  // would surface as an unhandled one. Attaching here settles that; the caller still sees the
  // interrupt because it races the same promise.
  interrupt.catch(() => undefined)

  return {
    signal: AbortSignal.any([runSignal, controller.signal]),
    interrupt,
    dispose: (): void => {
      clearTimeout(timer)

      if (onAbort !== undefined) {
        runSignal.removeEventListener('abort', onAbort)
      }
    },
  }
}

// Warn-only drift detection: a mismatch reaches the log, never the model or the caller.
function warnOnOutputDrift(run: RunView, prepared: PreparedToolCall, result: ToolResult): void {
  const schema = prepared.tool.outputSchema

  if (schema === undefined || result.isError) {
    return
  }

  const parsed = parseJsonOutput(result.content)

  if (parsed === undefined || schema.safeParse(parsed).success) {
    return
  }

  run.services.logger.warn('tool.output_mismatch', { tool: prepared.tool.name })
}

function parseJsonOutput(content: string): unknown | undefined {
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}

// Progress is advisory: a throwing observer must not fail the tool that reported.
function reportProgress(
  run: RunView,
  observer: ToolExecutionObserver,
  message: ProgressMessage
): void {
  try {
    observer.progress(message)
  } catch (err: unknown) {
    run.services.logger.warn('tool.progress_failed', {
      tool: run.identity.agentId,
      err: formatErrForLog(err),
    })
  }
}

function buildInvocationContext(
  run: RunView,
  deps: ToolExecutorDeps,
  options: {
    readonly callId: string
    readonly observer: ToolExecutionObserver | undefined
    readonly signal: AbortSignal
  }
): ToolInvocationContext {
  const { observer } = options
  const context: ToolInvocationContext = {
    callId: options.callId,
    userId: run.identity.userId,
    agentId: run.identity.agentId,
    sessionId: run.identity.sessionId,
    billingSessionId: run.identity.billingSessionId,
    billingAgentId: run.identity.billingAgentId,
    runId: run.identity.runId,
    approvalMode: run.env.approvalMode,
    audience: run.env.audience,
    channel: run.identity.channel,
    signal: options.signal,
    logger: run.services.logger,
    locale: run.env.locale,
    config: run.env.config,
    workspace: run.env.workspace,
    workspaceDir: run.env.workspaceDir,
    childEnv: run.env.childEnv,
    callDepth: run.env.callDepth,
    delegationChain: run.env.delegationChain,
    memory: deps.memory,
    bus: deps.bus,
    budget: run.state.budget,
    skillViewBudget: run.state.skillViewBudget,
    services: deps.services,
    deadline: run.state.deadline,
    maxDurationMs: run.env.limits.maxDurationMs,
    delegationQuota: run.state.delegationQuota,
    ...costCallbacks(run),
    ...(run.env.researchInteraction === undefined
      ? {}
      : { researchInteraction: run.env.researchInteraction }),
    ...(observer === undefined
      ? {}
      : {
          reportProgress: (message: ProgressMessage): void =>
            reportProgress(run, observer, message),
        }),
  }

  // exactOptionalPropertyTypes: an absent chatId must stay absent, not be set to undefined.
  if (run.identity.chatId === undefined) {
    return context
  }

  return { ...context, chatId: run.identity.chatId }
}

function prepareToolCall(deps: ToolExecutorDeps, run: RunView, call: ToolCall): ToolPreparation {
  const tool = run.env.tools.find((candidate) => candidate.name === call.name)
  const sink = resultSink(deps, run)

  if (tool === undefined) {
    return {
      kind: 'rejected',
      result: formatResult(
        new ToolError('unknown_tool', `tool ${call.name} not registered`),
        call,
        sink
      ),
    }
  }

  const parsed = parseToolInput(tool.inputSchema, coerceToolArgs(call.input))

  if (parsed.kind === 'error') {
    return {
      kind: 'rejected',
      result: formatResult(new ToolError('invalid_input', parsed.details), call, sink),
    }
  }

  return {
    kind: 'ready',
    prepared: {
      ...call,
      input: parsed.input,
      tool,
      presentation: resolveToolPresentation(tool, parsed.input, run.env.locale),
    },
  }
}

function resultSink(deps: ToolExecutorDeps, run: RunView): ResultSink {
  return { bus: deps.bus, maxBytes: run.env.limits.toolResultMaxBytes }
}

function formatResult(error: ToolError, call: ToolCall, sink: ResultSink): ToolResult {
  const base = formatPipelineResult({ content: error.message, isError: true }, call, sink)

  return { ...base, errorCode: error.code }
}

function formatPipelineResult(result: ToolResult, call: ToolCall, sink: ResultSink): ToolResult {
  const processed = OutputPipeline.process(result.content, {
    toolName: call.name,
    maxBytes: sink.maxBytes,
  })

  if (processed.threats.length > 0) {
    sink.bus.emit('tool_output_threat', {
      toolName: call.name,
      callId: call.id,
      findings: processed.threats,
    })
  }

  return {
    content: processed.text,
    isError: result.isError,
    ...(result.errorCode === undefined ? {} : { errorCode: result.errorCode }),
    ...(result.caveats === undefined ? {} : { caveats: result.caveats }),
    ...(result.display === undefined ? {} : { display: result.display }),
  }
}

function repairJson(raw: string): unknown | undefined {
  const trimmed = raw.trim().replace(TRAILING_COMMA_RE, '$1')
  const closers = closingDelimiters(trimmed)

  if (closers === undefined) {
    return undefined
  }

  try {
    return JSON.parse(trimmed + closers.reverse().join(''))
  } catch {
    return undefined
  }
}

function closingDelimiters(raw: string): string[] | undefined {
  const state: JsonScanState = { closers: [], inString: false, escaped: false }

  for (const char of raw) {
    if (!advanceJsonScan(state, char)) {
      return undefined
    }
  }

  return state.inString ? undefined : state.closers
}

interface JsonScanState {
  readonly closers: string[]
  inString: boolean
  escaped: boolean
}

function advanceJsonScan(state: JsonScanState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false
    return true
  }

  if (char === '\\' && state.inString) {
    state.escaped = true
    return true
  }

  if (char === '"') {
    state.inString = !state.inString
    return true
  }

  if (state.inString) {
    return true
  }

  if (char === '{') {
    state.closers.push('}')
    return true
  }

  if (char === '[') {
    state.closers.push(']')
    return true
  }

  if (char !== '}' && char !== ']') {
    return true
  }

  return state.closers.pop() === char
}

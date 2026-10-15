import { randomUUID } from 'node:crypto'

import type { ProgressMessage } from '@/core/stream-events'
import type { ToolCall, ToolResult } from '@/core/tool'
import type { RunResultReason } from '@/core/types/run'
import type { SessionQueue } from '@/core/types/session'
import type {
  McpToolInvocation,
  McpToolInvoker,
  RunIdentity,
  RunOptions,
  RunView,
  ToolExecutionObserver,
} from '@/engine/types/run'
import type { RunOnceDeps } from '@/engine/types/run-deps'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { RunHalted, ToolError } from '@/core/errors'
import { DEFAULT_AGENT_ID, LOCAL_USER_ID } from '@/core/ids'
import { prepareAgentScratchDir } from '@/core/security/agent-directories'
import { formatErrForLog } from '@/core/security/credentials'
import { MCP_SERVE_CALL_TIMEOUT_MS, MCP_TOOL_RESULT_MAX_BYTES } from '@/engine/constants'
import { assembleRun } from '@/engine/loop/context'
import { HALT_CODE_TO_REASON, RUN_REASON_TO_LIFECYCLE } from '@/engine/loop/finalize'
import { buildRunServices } from '@/engine/loop/run'
import { executeTool } from '@/engine/loop/turn'
import { composeAbort, TIMEOUT_ABORT } from '@/engine/run-registry'

const MCP_CHANNEL_ID = LOCAL_CHANNEL_ID
const MCP_ABORTED_MESSAGE = 'MCP tool call aborted'
const MCP_TIMEOUT_MESSAGE = 'MCP tool call timed out'

const noop = (): void => undefined

type McpStoppedReason = 'aborted' | 'timeout'

export interface McpToolInvokerDeps {
  readonly run: RunOnceDeps
  readonly sessionQueue: SessionQueue
  readonly sessionLifecycle: McpSessionLifecycle
}

export interface McpSessionLifecycle {
  open(identity: RunIdentity): Promise<void>
  close(identity: RunIdentity, reason: RunResultReason): Promise<void>
}

interface TrackedMcpToolInput {
  readonly deps: McpToolInvokerDeps
  readonly run: RunView
  readonly call: ToolCall
  readonly controller: AbortController
  readonly observer?: ToolExecutionObserver
}

export function createMcpToolInvoker(deps: McpToolInvokerDeps): McpToolInvoker {
  return {
    async invoke(input): Promise<ToolResult> {
      const agent = deps.run.agents.get(DEFAULT_AGENT_ID)

      if (agent === undefined) {
        return toolFailure(`MCP server needs the '${DEFAULT_AGENT_ID}' agent`)
      }

      try {
        return await deps.sessionQueue.enqueue(input.sessionId, () =>
          invokeTool(deps, agent, input)
        )
      } catch (err: unknown) {
        return toolFailure(formatErrForLog(err).message)
      }
    },
  }
}

async function invokeTool(
  deps: McpToolInvokerDeps,
  agent: RunView['env']['agent'],
  input: McpToolInvocation
): Promise<ToolResult> {
  const runDeps = deps.run

  if (runDeps.shutdownSignal.aborted || input.signal?.aborted) {
    return toolFailure(MCP_ABORTED_MESSAGE)
  }

  const workspace = await prepareAgentScratchDir(runDeps.config.paths.dataDir, agent.id)
  const services = buildRunServices({ deps: runDeps, agent })
  const approval: RunOptions =
    input.approval === undefined
      ? { approvalMode: 'unavailable' }
      : { approvalMode: 'manual', approval: input.approval }
  const { identity, env, state } = assembleRun(
    {
      tools: runDeps.tools,
      config: runDeps.config,
      childEnvBase: runDeps.childEnvBase,
      workspace,
    },
    {
      agentId: agent.id,
      sessionId: input.sessionId,
      userId: LOCAL_USER_ID,
      channel: MCP_CHANNEL_ID,
      userMessage: '',
    },
    {
      ...approval,
      audience: 'operator',
      toolTimeoutMs: MCP_SERVE_CALL_TIMEOUT_MS,
      toolResultMaxBytes: MCP_TOOL_RESULT_MAX_BYTES,
    },
    agent
  )
  const { controller, deadline, dispose } = composeAbort(
    [runDeps.shutdownSignal, input.signal],
    MCP_SERVE_CALL_TIMEOUT_MS
  )

  state.abort = controller
  state.deadline = deadline

  try {
    if (controller.signal.aborted) {
      return toolFailure(MCP_ABORTED_MESSAGE)
    }

    return await executeTrackedMcpTool({
      deps,
      run: { identity, env, state, services },
      call: { id: randomUUID(), name: input.name, input: input.input },
      controller,
      ...(input.progress === undefined ? {} : { observer: progressObserver(input.progress) }),
    })
  } finally {
    dispose()
  }
}

async function executeTrackedMcpTool(input: TrackedMcpToolInput): Promise<ToolResult> {
  const { deps, run, call, controller } = input
  const runDeps = deps.run
  let registered = false
  let sessionOpened = false
  let sessionReason: RunResultReason = 'error'

  try {
    await deps.sessionLifecycle.open(run.identity)
    sessionOpened = true
    runDeps.registry.register(run.identity, controller)
    registered = true

    const result = await executeMcpTool(run, call, input.observer)
    const stopped = resolveMcpStoppedReason(controller.signal)

    sessionReason = stopped ?? resolveMcpResultReason(result)
    return stopped === undefined ? result : stoppedToolFailure(stopped)
  } catch (err: unknown) {
    const stopped = resolveMcpStoppedReason(controller.signal)

    if (stopped !== undefined) {
      sessionReason = stopped
      return stoppedToolFailure(stopped)
    }

    sessionReason = err instanceof RunHalted ? HALT_CODE_TO_REASON[err.code] : 'error'
    return toolFailure(formatErrForLog(err).message)
  } finally {
    try {
      if (sessionOpened) {
        await closeMcpSession(deps, run.identity, sessionReason)
      }
    } finally {
      if (registered) {
        runDeps.registry.markDone(run.identity.runId, RUN_REASON_TO_LIFECYCLE[sessionReason])
      }
    }
  }
}

function executeMcpTool(
  run: RunView,
  call: ToolCall,
  observer?: ToolExecutionObserver
): Promise<ToolResult> {
  return executeTool(run, call, {
    admissionGates: run.services.hooks.toolAdmission,
    approvalGate: run.services.hooks.approvalGate,
    executor: run.services.executor,
    afterTool: run.services.hooks.afterTool,
    ...(observer === undefined ? {} : { observer }),
  })
}

/** Start and finish stay silent - the transport's request framing already marks both. */
function progressObserver(report: (message: ProgressMessage) => void): ToolExecutionObserver {
  return {
    start: noop,
    progress: report,
    finish: noop,
  }
}

async function closeMcpSession(
  deps: McpToolInvokerDeps,
  identity: RunIdentity,
  reason: RunResultReason
): Promise<void> {
  try {
    await deps.sessionLifecycle.close(identity, reason)
  } catch (err: unknown) {
    deps.run.logger.warn('mcp.session_finalize_failed', { err: formatErrForLog(err) })
  }
}

function resolveMcpResultReason(result: ToolResult): RunResultReason {
  return result.isError ? 'error' : 'completed'
}

function resolveMcpStoppedReason(signal: AbortSignal): McpStoppedReason | undefined {
  if (!signal.aborted) {
    return undefined
  }

  return signal.reason === TIMEOUT_ABORT ? 'timeout' : 'aborted'
}

export function toolFailure(message: string): ToolResult {
  return { content: new ToolError('unexpected', message).message, isError: true }
}

function stoppedToolFailure(reason: McpStoppedReason): ToolResult {
  return toolFailure(reason === 'timeout' ? MCP_TIMEOUT_MESSAGE : MCP_ABORTED_MESSAGE)
}

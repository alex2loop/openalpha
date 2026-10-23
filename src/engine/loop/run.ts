import type { ProviderChainRegistry } from '@/ai/api'
import type { BusEventMap } from '@/core/events'
import type { ProviderChain } from '@/core/llm'
import type { RunBookkeeping, RunDeps } from '@/engine/loop/context'
import type { SteeringInbox } from '@/engine/loop/drive'
import type { AgentProfile } from '@/engine/types/agent'
import type {
  RunHandle,
  RunInput,
  RunOptions,
  RunResult,
  RunServices,
  RunView,
} from '@/engine/types/run'
import type { RunOnceDeps } from '@/engine/types/run-deps'
import { RunHalted } from '@/core/errors'
import { prepareAgentScratchDir } from '@/core/security/agent-directories'
import { scrubCredentials } from '@/core/security/credentials'
import { EMPTY_LLM_USAGE_TOTALS } from '@/core/types/usage'
import { agentCapRejection } from '@/engine/budget/agent-cap'
import { RUN_TITLE_MAX_CHARS } from '@/engine/constants'
import { assembleRun } from '@/engine/loop/context'
import { createSteeringInbox, driveRun } from '@/engine/loop/drive'
import { HALT_CODE_TO_REASON } from '@/engine/loop/finalize'
import {
  abortedBeforeStartResult,
  agentNotFoundResult,
  isPausedFailClosed,
  pausedResult,
  preflightRun,
} from '@/engine/loop/preflight'
import { clampUserMessage } from '@/engine/loop/user-message'
import { composeAbort } from '@/engine/run-registry'

export async function runOnce(
  deps: RunOnceDeps,
  input: RunInput,
  options: RunOptions = {}
): Promise<RunResult> {
  const configuredAgent = deps.agents.get(input.agentId)

  if (configuredAgent === undefined) {
    return agentNotFoundResult(input.agentId)
  }

  const agent = deps.agentForRun?.(input, configuredAgent) ?? configuredAgent

  if (deps.shutdownSignal.aborted || options.parentSignal?.aborted) {
    return abortedBeforeStartResult()
  }

  const userMessage = clampUserMessage(input.userMessage)

  try {
    const refusal = await refuseAtAdmission(deps, { input, options })

    if (refusal !== undefined) {
      return refusal
    }

    const { run, bookkeeping } = await prepareRun({
      deps,
      input,
      options,
      agent,
      userMessage,
    })
    // Re-checked after preparation: an abort landing during it would otherwise reach beforeRun,
    // which opens a durable session row.
    const rejection = preflightRun([deps.shutdownSignal, options.parentSignal], run.state)

    if (rejection !== undefined) {
      return rejection
    }

    const { controller, deadline, dispose } = composeAbort(
      [deps.shutdownSignal, options.parentSignal],
      run.env.limits.maxDurationMs
    )

    run.state.abort = controller
    run.state.deadline = deadline

    const steering = createSteeringInbox()
    const handle = registerRun({ deps, run, controller, dispose, steering, userMessage })

    return await driveRun({
      run,
      bookkeeping,
      drive: {
        deps,
        handle,
        dispose,
        onChunk: input.onChunk,
        onWorkStart: options.onWorkStart,
        steering,
        progress: { workStarted: false },
      },
    })
  } catch (err: unknown) {
    return resultForPreRegistrationFailure(err)
  }
}

interface RegisterRunInput {
  readonly deps: RunOnceDeps
  readonly run: RunView
  readonly controller: AbortController
  readonly dispose: () => void
  readonly steering: SteeringInbox
  readonly userMessage: string
}

/** The registry entry and the start announcement go together: a feed that heard `run_started`
 *  can always find the run it describes. */
function registerRun(input: RegisterRunInput): RunHandle {
  const { deps, run, controller, dispose, steering, userMessage } = input
  let handle: RunHandle

  try {
    handle = deps.registry.register(run.identity, controller, steering.accept)
  } catch (err: unknown) {
    dispose()
    throw err
  }

  const { identity } = run
  const title = identity.parentRunId === undefined ? toRunTitle(userMessage) : undefined
  const hidden: Pick<BusEventMap['run_started'], 'hidden'> =
    run.env.answerVisibility === 'hidden' ? { hidden: true } : {}

  run.services.bus.emit('run_started', {
    runId: identity.runId,
    agentId: identity.agentId,
    sessionId: identity.sessionId,
    channel: identity.channel,
    ...(identity.chatId === undefined ? {} : { chatId: identity.chatId }),
    ...(identity.parentRunId === undefined ? {} : { parentRunId: identity.parentRunId }),
    ...(title === undefined ? {} : { title }),
    ...hidden,
    startedAt: Date.now(),
  })

  return handle
}

// Scrubbed before the cut: a credential sliced in half would no longer match its pattern.
function toRunTitle(userMessage: string): string | undefined {
  const title = scrubCredentials(userMessage).trim().slice(0, RUN_TITLE_MAX_CHARS).trim()

  return title === '' ? undefined : title
}

interface AdmissionInput {
  readonly input: RunInput
  readonly options: RunOptions
}

/** Whether to start at all, decided once here for every surface. The cap speaks only for a root run:
 *  a debate's roles and a delegated child belong to a run already admitted, and refusing them halfway
 *  would waste what was spent and leave an inconclusive call. */
async function refuseAtAdmission(
  deps: RunOnceDeps,
  admission: AdmissionInput
): Promise<RunResult | undefined> {
  const { input, options } = admission

  if (await isPausedFailClosed(deps, input.agentId)) {
    return pausedResult()
  }

  if (options.parent !== undefined || options.parentRunId !== undefined) {
    return undefined
  }

  const billing = deps.agents.get(options.billingAgentId ?? input.agentId)

  return agentCapRejection(deps, billing, Date.now())
}

interface PreparedRun {
  readonly run: RunView
  readonly bookkeeping: RunBookkeeping
}

interface PrepareRunInput {
  readonly deps: RunOnceDeps
  readonly input: RunInput
  readonly options: RunOptions
  readonly agent: AgentProfile
  readonly userMessage: string
}

async function prepareRun(input: PrepareRunInput): Promise<PreparedRun> {
  const { deps, input: runInput, options, agent, userMessage } = input
  const workspace = await prepareAgentScratchDir(deps.config.paths.dataDir, agent.id)
  const runDeps: RunDeps = {
    tools: deps.tools,
    config: deps.config,
    childEnvBase: deps.childEnvBase,
    workspace,
  }

  // Seed the stored cumulative totals so finalize's REPLACE-upsert writes the true aggregate,
  // not just this run's. `runInput.sessionId` is read here because it is needed before assembleRun.
  const resuming = deps.history !== undefined && options.parent === undefined
  const initialTotals =
    resuming && deps.priorTotals !== undefined
      ? await deps.priorTotals(runInput.sessionId)
      : undefined
  const { identity, env, state, bookkeeping } = assembleRun(
    runDeps,
    { ...runInput, userMessage },
    { ...options, ...(initialTotals === undefined ? {} : { initialTotals }) },
    agent,
    options.parent
  )
  const services = buildRunServices({
    deps,
    agent,
    bindings: {
      agentId: identity.agentId,
      sessionId: identity.sessionId,
      runId: identity.runId,
    },
  })
  const run: RunView = { identity, env, state, services }

  if (deps.history !== undefined && options.parent === undefined) {
    run.state.messages.loadHistory(
      await deps.history(identity.sessionId, run.state.messages.historyWindow)
    )
  }

  if (runInput.lead !== undefined) {
    run.state.messages.appendTransient({ role: 'user', content: runInput.lead })
  }

  run.state.messages.appendDirect({ role: 'user', content: userMessage })

  return { run, bookkeeping }
}

function resultForPreRegistrationFailure(err: unknown): RunResult {
  if (err instanceof RunHalted) {
    return {
      reason: HALT_CODE_TO_REASON[err.code],
      text: '',
      totals: EMPTY_LLM_USAGE_TOTALS,
      workStarted: false,
      // An abort here is the shutdown/parent-signal path before registration; no haltCode, matching
      // classifyCaught's treatment of abort.
      ...(err.code === 'abort' ? {} : { haltCode: err.code }),
      ...(err.detail === undefined ? {} : { haltDetail: err.detail }),
      errorMessage: `${err.code}: ${scrubCredentials(err.message)}`,
    }
  }

  const message = err instanceof Error ? scrubCredentials(err.message) : String(err)

  return {
    reason: 'error',
    text: '',
    totals: EMPTY_LLM_USAGE_TOTALS,
    workStarted: false,
    errorMessage: message,
  }
}

interface BuildRunServicesInput {
  readonly deps: RunOnceDeps
  readonly agent: AgentProfile
  readonly bindings?: Readonly<Record<string, unknown>>
}

export function buildRunServices(input: BuildRunServicesInput): RunServices {
  const chain = resolveChain(input.deps.chains, input.agent)

  return {
    chain,
    hooks: input.deps.hooks,
    compactor: input.deps.compactor,
    executor: input.deps.executor,
    costTracker: input.deps.costTracker,
    llmAttemptSink: input.deps.llmAttemptSink,
    unrecordedSpend: input.deps.unrecordedSpend,
    pricing: input.deps.pricing,
    rateLimiter: input.deps.rateLimiter,
    logger:
      input.bindings === undefined ? input.deps.logger : input.deps.logger.child(input.bindings),
    bus: input.deps.bus,
  }
}

function resolveChain(chains: ProviderChainRegistry, agent: AgentProfile): ProviderChain {
  return agent.modelChain.kind === 'primary'
    ? chains.primary
    : chains.resolveTier(agent.modelChain.name)
}

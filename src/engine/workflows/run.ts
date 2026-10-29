import { randomUUID } from 'node:crypto'

import type { ChannelId } from '@/core/channels'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { TaskPassListener } from '@/core/container'
import type { HaltCode } from '@/core/errors'
import type { Logger } from '@/core/logging/logger'
import type { RunResultReason } from '@/core/types/run'
import type { Budget } from '@/engine/types/cost'
import type { RunInput, Runner, RunOptions, RunResult } from '@/engine/types/run'
import type { Workflow, WorkflowContext } from '@/engine/workflows/types'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { reportPass } from '@/core/container'
import { RunHalted } from '@/core/errors'
import { type AgentId, LOCAL_USER_ID, sessionId, type UserId } from '@/core/ids'
import { formatErrForLog, scrubCredentials } from '@/core/security/credentials'
import { advanceCron, isSlotLate } from '@/core/utils/cron'
import { probeHost, REACHABILITY_HOST, REACHABILITY_TIMEOUT_MS } from '@/core/utils/reachability'
import { sleep } from '@/core/utils/time'
import { createConfiguredRunBudget } from '@/engine/budget/run-budget'
import {
  MAX_WORKFLOW_STEPS,
  NON_TRANSIENT_HALT_CODES,
  RETRYABLE_REASONS,
  WORKFLOW_STEP_ATTEMPTS,
  WORKFLOW_STEP_RETRY_BASE_MS,
  WORKFLOW_TICK_MS,
} from '@/engine/constants'

const WORKFLOW_CHANNEL_ID = LOCAL_CHANNEL_ID
const WORKFLOWS_PASS = { name: 'workflows', everyMs: WORKFLOW_TICK_MS }
const WORKFLOW_HALT_CODE_BY_REASON = {
  aborted: 'abort',
  budget: 'budget',
  error: 'llm_error',
  turn_limit: 'turn_limit',
  loop: 'loop',
  timeout: 'abort',
} as const satisfies Record<Exclude<RunResultReason, 'completed'>, HaltCode>

interface StepLabel {
  readonly id: string
  readonly step: number
  readonly agent: AgentId
}

interface ScheduledWorkflowDeps {
  readonly workflows: ReadonlyMap<string, Workflow>
  readonly logger: Logger
  readonly runner: Runner
  readonly config: ResolvedConfig
  readonly onTaskPass: TaskPassListener
}

/** Identity and cancellation passed from a surface that invokes a workflow directly. */
export interface WorkflowInvocation {
  readonly channel: ChannelId
  readonly userId: UserId
  readonly chatId: string
  readonly parentSignal: AbortSignal
}

export interface WorkflowRunDeps {
  readonly runner: Runner
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly workflow: Workflow
  readonly invocation?: WorkflowInvocation
  readonly parentSignal?: AbortSignal
}

export type WorkflowStop = () => Promise<void>

interface WorkflowResult {
  readonly id: string
  readonly ok: boolean
  readonly steps: number
  readonly costUsd: number
  readonly output?: unknown
  readonly error?: string
}

interface WorkflowRunContext {
  readonly options: RunOptions
  createInput(agent: AgentId, userMessage: string): RunInput
}

export async function runWorkflow(deps: WorkflowRunDeps): Promise<WorkflowResult> {
  const { runner, logger, workflow } = deps
  // One per-run cap covers every step and retry of this workflow run.
  const budget = createConfiguredRunBudget(deps.config)
  const runContext = createWorkflowRunContext(deps.invocation, deps.parentSignal, budget)
  let steps = 0
  let costUsd = 0

  const ctx: WorkflowContext = {
    run: async (agent, userMessage): Promise<RunResult> => {
      if (steps >= MAX_WORKFLOW_STEPS) {
        throw new RunHalted(
          'turn_limit',
          `workflow '${workflow.id}' exceeded ${MAX_WORKFLOW_STEPS} steps`
        )
      }

      steps += 1

      const result = await runStep(runner, () => runContext.createInput(agent, userMessage), {
        logger,
        label: { id: workflow.id, step: steps, agent },
        options: runContext.options,
      })

      costUsd += result.totalCostUsd
      assertWorkflowStepCompleted(result)

      return result
    },
  }

  try {
    const output = await workflow.run(ctx)

    logger.info('workflow.done', { id: workflow.id, steps, costUsd })

    return { id: workflow.id, ok: true, steps, costUsd, output }
  } catch (err: unknown) {
    logger.warn('workflow.failed', { id: workflow.id, steps, costUsd, err: formatErrForLog(err) })

    return {
      id: workflow.id,
      ok: false,
      steps,
      costUsd,
      error: scrubCredentials(formatErrForLog(err).message),
    }
  }
}

export function assertWorkflowStepCompleted(result: RunResult): void {
  if (result.completionCode !== undefined) {
    throw new RunHalted('abort', `workflow step ended: ${result.completionCode}`)
  }

  if (result.reason === 'completed') {
    return
  }

  throw new RunHalted(
    WORKFLOW_HALT_CODE_BY_REASON[result.reason],
    result.errorMessage ?? `workflow step ended: ${result.reason}`
  )
}

interface StepResult extends RunResult {
  readonly totalCostUsd: number
}

function isCompletedStep(result: RunResult | undefined): boolean {
  return result?.reason === 'completed' && result.completionCode === undefined
}

function isTransient(caught: unknown, result: RunResult | undefined): boolean {
  if (caught !== undefined) {
    return true
  }

  if (result === undefined || !RETRYABLE_REASONS.has(result.reason)) {
    return false
  }

  return result.haltCode === undefined || !NON_TRANSIENT_HALT_CODES.has(result.haltCode)
}

async function runStep(
  runner: Runner,
  // Each attempt calls this fresh: a retry gets a brand-new session identity, so it starts from the
  // pre-attempt (blank) state instead of replaying a prior failed attempt's persisted history and
  // duplicating its user message on top.
  createInput: () => RunInput,
  step: {
    readonly logger: Logger
    readonly label: StepLabel
    readonly options: RunOptions
  }
): Promise<StepResult> {
  const { logger, label } = step
  let result: RunResult | undefined
  let caught: unknown
  let totalCostUsd = 0

  for (let attempt = 1; attempt <= WORKFLOW_STEP_ATTEMPTS; attempt++) {
    caught = undefined
    result = undefined

    try {
      result = await runner.run(createInput(), step.options)
    } catch (err: unknown) {
      caught = err
    }

    if (result !== undefined) {
      totalCostUsd += result.totals.costUsd

      if (isCompletedStep(result)) {
        logger.info('workflow.step', { ...label, attempt, costUsd: result.totals.costUsd })

        return { ...result, totalCostUsd }
      }
    }

    const detail = caught === undefined ? result?.reason : formatErrForLog(caught)

    if (!isTransient(caught, result) || attempt === WORKFLOW_STEP_ATTEMPTS) {
      logger.warn('workflow.step_failed', { ...label, attempt, detail })
      break
    }

    logger.warn('workflow.step_retry', { ...label, attempt, detail })
    await sleep(WORKFLOW_STEP_RETRY_BASE_MS * attempt, step.options.parentSignal)
  }

  if (result !== undefined) {
    return { ...result, totalCostUsd }
  }

  throw caught
}

function createWorkflowRunContext(
  invocation: WorkflowInvocation | undefined,
  parentSignal: AbortSignal | undefined,
  budgetSlice: Budget
): WorkflowRunContext {
  if (invocation === undefined) {
    return {
      options: {
        approvalMode: 'unavailable',
        budgetSlice,
        ...(parentSignal === undefined ? {} : { parentSignal }),
      },
      createInput: (agent, userMessage) => ({
        agentId: agent,
        sessionId: sessionId(randomUUID()),
        userId: LOCAL_USER_ID,
        channel: WORKFLOW_CHANNEL_ID,
        userMessage,
      }),
    }
  }

  return {
    options: { chatId: invocation.chatId, parentSignal: invocation.parentSignal, budgetSlice },
    createInput: (agent, userMessage) => ({
      agentId: agent,
      sessionId: sessionId(randomUUID()),
      userId: invocation.userId,
      channel: invocation.channel,
      userMessage,
    }),
  }
}

// The interval is torn down on abort, so a shutdown never leaves it pinning the event loop.
export function startScheduledWorkflows(
  deps: ScheduledWorkflowDeps,
  signal: AbortSignal
): WorkflowStop {
  // The registry is built at boot and never gains an entry afterwards, so a set with no scheduled
  // workflow can never produce work: arm nothing rather than wake every 30s to find that out.
  if (signal.aborted || !hasScheduledWorkflow(deps.workflows)) {
    return async () => undefined
  }

  const stopping = new AbortController()
  const tick = createWorkflowTick(deps, AbortSignal.any([signal, stopping.signal]))
  let tickTask: Promise<void> | undefined
  let stopTask: Promise<void> | undefined

  // A tick that would overlap the previous one is dropped rather than started, so `tickTask`
  // always holds the pass `stop` has to wait for.
  const timer = setInterval(() => {
    if (tickTask !== undefined || stopping.signal.aborted) {
      return
    }

    tickTask = reportPass(deps.onTaskPass, WORKFLOWS_PASS, tick)
      .catch((err: unknown) => {
        deps.logger.warn('workflow.tick_failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        tickTask = undefined
      })
  }, WORKFLOW_TICK_MS)
  timer.unref()

  const stop = (): Promise<void> => {
    stopTask ??= settle()
    return stopTask
  }

  const settle = async (): Promise<void> => {
    stopping.abort()
    clearInterval(timer)
    signal.removeEventListener('abort', stop)
    await tickTask
  }

  signal.addEventListener('abort', stop, { once: true })

  return stop
}

interface TickWindow {
  readonly last: number
  readonly now: number
  readonly defaultTz: string
}

// Offline or not, a window is closed only by a complete pass: one that did not reach the end
// replays at the next tick, so a trigger is lost only by waiting past `late_grace_ms`.
function createWorkflowTick(deps: ScheduledWorkflowDeps, signal: AbortSignal): () => Promise<void> {
  let last = Date.now()
  // One warning per offline stretch, cleared when the network answers or nothing is waiting.
  let offlineWarned = false

  return async () => {
    const now = Date.now()
    const due = dueWorkflows(deps, { last, now, defaultTz: deps.config.locale.timezone })

    // An offline run fails every step; the slot stays in the window and goes once the network is back.
    if (due.length > 0 && !(await probeHost(REACHABILITY_HOST, REACHABILITY_TIMEOUT_MS, signal))) {
      if (!(signal.aborted || offlineWarned)) {
        deps.logger.warn('workflow.tick_offline', {
          workflows: due.length,
          host: REACHABILITY_HOST,
        })
        offlineWarned = true
      }

      return
    }

    offlineWarned = false

    for (const wf of due) {
      if (signal.aborted) {
        return
      }

      await runScheduledWorkflow({ wf, deps, signal })
    }

    last = now
  }
}

// A slot answered past `late_grace_ms` belongs to a session that has passed, as for a cron job: it
// is skipped and the workflow waits for its next one.
function dueWorkflows(deps: ScheduledWorkflowDeps, window: TickWindow): Workflow[] {
  const due: Workflow[] = []

  for (const wf of deps.workflows.values()) {
    const slotAt = dueSlotAt(wf, window)

    if (slotAt === undefined) {
      continue
    }

    if (isSlotLate(slotAt, window.now, deps.config.schedule.lateGraceMs)) {
      deps.logger.info('workflow.slot_missed', { id: wf.id, lateMs: window.now - slotAt })
      continue
    }

    due.push(wf)
  }

  return due
}

interface ScheduledWorkflowTickOptions {
  readonly wf: Workflow
  readonly deps: ScheduledWorkflowDeps
  readonly signal: AbortSignal
}

async function runScheduledWorkflow(options: ScheduledWorkflowTickOptions): Promise<void> {
  const { wf, deps, signal } = options

  try {
    await runWorkflow({
      runner: deps.runner,
      config: deps.config,
      logger: deps.logger,
      workflow: wf,
      parentSignal: signal,
    })
  } catch (err: unknown) {
    deps.logger.warn('workflow.trigger_failed', { id: wf.id, err: formatErrForLog(err) })
  }
}

function hasScheduledWorkflow(workflows: ReadonlyMap<string, Workflow>): boolean {
  return [...workflows.values()].some((wf) => wf.schedule !== undefined)
}

/** When the first slot after the window opened fell, if it has already passed. */
function dueSlotAt(wf: Workflow, window: TickWindow): number | undefined {
  if (wf.schedule === undefined) {
    return undefined
  }

  const next = advanceCron(wf.schedule, new Date(window.last), wf.tz ?? window.defaultTz).getTime()

  return next <= window.now ? next : undefined
}

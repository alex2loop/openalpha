import type { ResolvedConfig } from '@/core/config/resolve'
import type { TaskPassListener } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { Runner } from '@/engine/types/run'
import type { Workflow } from '@/engine/workflows/types'
import { reportPass } from '@/core/container'
import { REACHABILITY_HOST, REACHABILITY_TIMEOUT_MS } from '@/core/limits'
import { formatErrForLog } from '@/core/security/credentials'
import { advanceCron, isSlotLate } from '@/core/utils/cron'
import { probeHost } from '@/core/utils/reachability'
import { WORKFLOW_TICK_MS } from '@/engine/constants'
import { runWorkflow } from '@/engine/workflows/run'

const WORKFLOWS_PASS = { name: 'workflows', everyMs: WORKFLOW_TICK_MS }

interface ScheduledWorkflowDeps {
  readonly workflows: ReadonlyMap<string, Workflow>
  readonly logger: Logger
  readonly runner: Runner
  readonly config: ResolvedConfig
  readonly onTaskPass: TaskPassListener
}

export type WorkflowStop = () => Promise<void>

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

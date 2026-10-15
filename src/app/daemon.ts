import type { DeliveryHub } from '@/app/services'
import type { StartChannelsDeps } from '@/channels/api'
import type { App, DaemonTask } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import type { WorkspaceCleanupResult } from '@/engine/api'
import { refreshMarketDataOnBoot } from '@/app/boot-refresh'
import { toAgentRegistry } from '@/app/services'
import { startSocialUpkeep } from '@/app/social-upkeep'
import { startUpdateWatch } from '@/app/update-watch'
import { startChannels } from '@/channels/api'
import { AppError, ConfigError } from '@/core/errors'
import { pruneRemovedAgentLogs } from '@/core/logging/retention'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR } from '@/core/utils/time'
import { pruneExpiredWorkspaceTmp, startScheduledWorkflows } from '@/engine/api'
import { runRetention } from '@/persistence/api'

const SHUTDOWN_DRAIN_MS = 5_000
const SHUTDOWN_TOTAL_MS = 30_000
const RETENTION_INTERVAL_MS = 6 * MS_PER_HOUR

declare module '@/core/container' {
  interface Services {
    /** The whole daemon as one task: what `start` runs, and the only thing that owns the drain. */
    daemonTask: DaemonTask
  }
}

type Disposer = () => void | Promise<void>

// The daemon-only half of the process: everything here is started on `start(signal)` and torn down
// exactly once, in the order of spec §13 Pillar B — shed new work, then drain runs, then dispose.
// `markStaleRuns` is NOT here: boot already ran it before any subsystem could open a run.
export function createDaemonTask(app: App, delivery: DeliveryHub): DaemonTask {
  return {
    name: 'daemon',
    async start(signal: AbortSignal): Promise<void> {
      // Guard before side effects: an already-aborted signal must not arm subsystems that would
      // then wait forever for an 'abort' event that has already fired.
      if (signal.aborted) {
        return
      }

      const logger = app.resolve('logger')
      const disposers: Disposer[] = []
      // `startup` owns the subsystems while boot is still acquiring them: a failure partway tears
      // every already-started subsystem down, and the wait below ends on either real shutdown or it.
      const startup = new AbortController()
      const startupSignal = AbortSignal.any([signal, startup.signal])
      const abortWaiter = createAbortWaiter(startupSignal)
      const taskState: DaemonTaskState = {}
      const tasks: Promise<void>[] = []

      try {
        await runWorkspaceTmpRetention(app, logger, retentionCutoffAt(app))

        const refreshed = await refreshMarketDataOnBoot({
          app,
          logger,
          signal: startupSignal,
          track: (task) =>
            trackDaemonTask({
              tasks,
              state: taskState,
              startup,
              name: 'trading.boot-refresh',
              task,
            }),
        })

        if (!refreshed) {
          return
        }

        await startDaemonSubsystems({
          app,
          delivery,
          startupSignal,
          startup,
          logger,
          tasks,
          state: taskState,
          disposers,
        })

        logger.info('daemon.started')

        await abortWaiter.promise

        if (taskState.failure !== undefined) {
          throw taskState.failure
        }
      } catch (err: unknown) {
        throw toDaemonStartupError(err)
      } finally {
        startup.abort()
        abortWaiter.dispose()
        await shutdown({ app, disposers, logger, tasks })
      }
    },
  }
}

interface StartDaemonSubsystemsOptions {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly startupSignal: AbortSignal
  readonly startup: AbortController
  readonly logger: Logger
  readonly tasks: Array<Promise<void>>
  readonly state: DaemonTaskState
  readonly disposers: Disposer[]
}

async function startDaemonSubsystems(options: StartDaemonSubsystemsOptions): Promise<void> {
  const { app, delivery, startupSignal, startup, logger, tasks, state, disposers } = options

  const channels = await startChannels(channelDeps(app, startupSignal))
  disposers.push(() => channels.stop())
  disposers.push(
    startScheduledWorkflows(
      {
        workflows: app.resolve('workflows'),
        logger,
        defaultTz: app.config.locale.timezone,
        runner: app.resolve('runner'),
      },
      startupSignal
    )
  )

  // Only now does a proactive notice have anywhere to go. Detached first on the way down, so
  // nothing is queued against an adapter that is already closing.
  if (channels.notifier !== undefined) {
    disposers.unshift(
      delivery.attach({
        notifier: channels.notifier,
        snapshots: channels.snapshots,
        ...(channels.defaultRecipient === undefined
          ? {}
          : { recipient: channels.defaultRecipient }),
      })
    )
  }

  // Started last of the delivering subsystems: a job that finishes before delivery is attached has
  // nowhere to send its answer, and a one-shot job is disabled on finalize so it never retries.
  trackDaemonTask({
    tasks,
    state,
    startup,
    name: 'scheduler',
    task: app.resolve('schedulerTask').start(startupSignal),
  })

  // After delivery is attached: an alert or brief that fires on the first tick must have a channel
  // to reach. Each task goes through the same tracker as the scheduler's, but a trading loop
  // quarantines its own failure first, so a bad tick stops that loop and not the daemon.
  for (const task of app.resolve('tradingServices').daemonTasks) {
    trackDaemonTask({ tasks, state, startup, name: task.name, task: task.start(startupSignal) })
  }

  disposers.push(startRetention(app, logger))
  disposers.push(startUpdateWatch(app, logger))
  disposers.push(startSocialUpkeep(app, logger))

  attachPluginTasks({ app, signal: startupSignal, startup, tasks, state })

  if (app.config.api.enabled) {
    disposers.push(await app.resolve('apiStarter')(app, process.env))
    logger.info('api.started', { port: app.config.api.port })
  }
}

function toDaemonStartupError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err
  }

  return new ConfigError('daemon startup failed', err)
}

function retentionCutoffAt(app: App): number {
  return Date.now() - app.config.retention.days * MS_PER_DAY
}

async function runWorkspaceTmpRetention(app: App, logger: Logger, cutoffAt: number): Promise<void> {
  try {
    const result = await pruneExpiredWorkspaceTmp({
      dataDir: app.config.paths.dataDir,
      cutoffAt,
    })
    const summary = summarizeWorkspaceResult(result)

    logger.info('workspace.tmp_retention', summary)
  } catch (err: unknown) {
    logger.warn('workspace.tmp_retention_failed', { err: formatErrForLog(err) })
  }
}

function summarizeWorkspaceResult(result: WorkspaceCleanupResult): {
  readonly removedFiles: number
  readonly removedBytes: number
  readonly failures: number
} {
  let removedFiles = 0
  let removedBytes = 0
  let failures = 0

  for (const agent of result.agents.values()) {
    removedFiles += agent.removedFiles
    removedBytes += agent.removedBytes
    failures += agent.failures
  }

  return { removedFiles, removedBytes, failures }
}

interface AttachPluginTasksOptions {
  readonly app: App
  readonly signal: AbortSignal
  readonly startup: AbortController
  readonly tasks: Array<Promise<void>>
  readonly state: DaemonTaskState
}

function attachPluginTasks(options: AttachPluginTasksOptions): void {
  const { app, signal, startup, tasks, state } = options
  for (const plugin of app.resolve('plugins')) {
    for (const task of plugin.contributions.daemonTasks ?? []) {
      trackDaemonTask({ tasks, state, startup, name: task.name, task: task.start(signal) })
    }
  }
}

interface DaemonTaskState {
  failure?: AppError
}

interface TrackDaemonTaskOptions {
  readonly tasks: Promise<void>[]
  readonly state: DaemonTaskState
  readonly startup: AbortController
  readonly name: string
  readonly task: Promise<void>
}

function trackDaemonTask(options: TrackDaemonTaskOptions): void {
  const { tasks, state, startup, name, task } = options
  tasks.push(
    task.catch((err: unknown) => {
      state.failure ??= new ConfigError(`daemon task failed: ${name}`, err)
      startup.abort(state.failure)
    })
  )
}

function channelDeps(app: App, signal: AbortSignal): StartChannelsDeps {
  return {
    definitions: app.resolve('channels'),
    config: app.config,
    runner: app.resolve('runner'),
    runRegistry: app.resolve('runRegistry'),
    sessionQueue: app.resolve('sessionQueue'),
    costTracker: app.resolve('costTracker'),
    pairingStore: app.resolve('pairingStore'),
    sessionRouter: app.resolve('sessionRouter'),
    sessions: app.resolve('sessionStore'),
    spend: app.resolve('spendReader'),
    pollOffsets: app.resolve('pollOffsetStore'),
    inbox: app.resolve('inboundInbox'),
    bindings: app.resolve('chatBindingStore'),
    dispatcher: app.resolve('slashDispatcher'),
    agents: toAgentRegistry(app.resolve('agents')),
    bus: app.resolve('bus'),
    logger: app.resolve('logger'),
    // Injected once here so no adapter reaches for process.env on its own.
    env: process.env,
    shutdownSignal: signal,
  }
}

function startRetention(app: App, logger: Logger): Disposer {
  const configuredAgentIds = Object.freeze(new Set(app.resolve('agents').keys()))
  let inFlight: Promise<void> | null = null

  const sweep = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = runRetentionSweep(app, logger, configuredAgentIds)
      .catch((err: unknown) => {
        logger.warn('retention.failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(sweep, RETENTION_INTERVAL_MS)
  // A pruning sweep is never worth holding the process open for.
  timer.unref()
  // Run the first sweep immediately so a long-lived daemon does not wait half an hour
  // before reclaiming anything created while it was down.
  sweep()

  return async () => {
    clearInterval(timer)
    if (inFlight !== null) {
      await inFlight
    }
  }
}

async function runRetentionSweep(
  app: App,
  logger: Logger,
  configuredAgentIds: ReadonlySet<string>
): Promise<void> {
  const cutoffAt = retentionCutoffAt(app)

  await runRetention(app.resolve('storage'), app.resolve('dialect'), {
    config: {
      retentionDays: app.config.retention.days,
      inboxRetentionDays: app.config.retention.inboxDays,
    },
    logger,
  }).catch((err: unknown) => {
    logger.warn('retention.database_failed', { err: formatErrForLog(err) })
  })

  await runWorkspaceTmpRetention(app, logger, cutoffAt)

  const logResult = await pruneRemovedAgentLogs({
    dataDir: app.config.paths.dataDir,
    configuredAgentIds,
    cutoffAt,
  }).catch((err: unknown) => {
    logger.warn('retention.agent_logs_failed', { err: formatErrForLog(err) })
    return undefined
  })

  if (logResult !== undefined) {
    logger.info('retention.agent_logs', {
      removedDirectories: logResult.removedDirectories,
      removedBytes: logResult.removedBytes,
      failures: logResult.failures,
    })
  }
}

interface AbortWaiter {
  readonly promise: Promise<void>
  readonly dispose: () => void
}

function createAbortWaiter(signal: AbortSignal): AbortWaiter {
  if (signal.aborted) {
    return { promise: Promise.resolve(), dispose: () => undefined }
  }

  let resolve: () => void = () => undefined
  const onAbort = (): void => {
    signal.removeEventListener('abort', onAbort)
    resolve()
  }
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  signal.addEventListener('abort', onAbort, { once: true })

  return {
    promise,
    dispose: () => {
      signal.removeEventListener('abort', onAbort)
    },
  }
}

// Shed new work first (admission stops before anything drains), then drain in-flight runs
// (SHUTDOWN_DRAIN_MS to land), then dispose, then settle every task. The force timer throws
// through the process fatal boundary so its final diagnostic is flushed by the boot-owned logger
// before the process exits.
async function shutdown(options: {
  readonly app: App
  readonly disposers: readonly Disposer[]
  readonly logger: Logger
  readonly tasks: readonly Promise<void>[]
}): Promise<void> {
  const { app, disposers, logger, tasks } = options
  const force = setTimeout(() => {
    throw new ConfigError('daemon shutdown exceeded its deadline')
  }, SHUTDOWN_TOTAL_MS)
  force.unref()

  try {
    await runCleanup(logger, 'daemon.pause_failed', () => app.resolve('sessionQueue').pause())
    await runCleanup(logger, 'daemon.drain_failed', () =>
      app.resolve('runRegistry').drain(SHUTDOWN_DRAIN_MS)
    )

    for (const dispose of disposers) {
      await runCleanup(logger, 'daemon.dispose_failed', dispose)
    }

    await Promise.allSettled(tasks)
    logger.info('daemon.stopped')
  } finally {
    clearTimeout(force)
  }
}

async function runCleanup(
  logger: Logger,
  event: string,
  cleanup: () => void | Promise<void>
): Promise<void> {
  try {
    await cleanup()
  } catch (err: unknown) {
    logger.warn(event, { err: formatErrForLog(err) })
  }
}

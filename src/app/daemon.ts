import type { DeliveryHub } from '@/app/delivery'
import type { StartChannelsDeps, StartChannelsResult } from '@/channels/api'
import type { App, DaemonStartOptions, DaemonTask, DegradedItem } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { refreshMarketDataOnBoot } from '@/app/boot-refresh'
import { startChannelWatch } from '@/app/channel-watch'
import { retentionCutoffAt, runWorkspaceTmpRetention, startRetention } from '@/app/retention'
import { ApiTokenError } from '@/app/server/http/auth'
import { toAgentRegistry } from '@/app/services'
import { startSocialUpkeep } from '@/app/social-upkeep'
import { startUpdateWatch } from '@/app/update/watch'
import { startChannels } from '@/channels/api'
import { BRAND } from '@/core/brand'
import { AppError, ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { startScheduledWorkflows } from '@/engine/api'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

const SHUTDOWN_DRAIN_MS = 5_000
const SHUTDOWN_TOTAL_MS = 30_000

declare module '@/core/container' {
  interface Services {
    /** The whole daemon as one task: what `start` runs, and the only thing that owns the drain. */
    daemonTask: DaemonTask
  }
}

type Disposer = () => void | Promise<void>

/** What the way down runs: `admission` closers first and synchronously, `disposers` after the drain. */
interface Teardown {
  readonly admission: Array<() => void>
  readonly disposers: Disposer[]
}

// The daemon-only half of the process: everything here is started on `start(signal)` and torn down
// exactly once, in the order of spec §13 Pillar B — shed new work, then drain runs, then dispose.
// `markStaleRuns` is NOT here: boot already ran it before any subsystem could open a run.
export function createDaemonTask(app: App, delivery: DeliveryHub): DaemonTask {
  return {
    name: 'daemon',
    async start(signal: AbortSignal, options?: DaemonStartOptions): Promise<void> {
      // Guard before side effects: an already-aborted signal must not arm subsystems that would
      // then wait forever for an 'abort' event that has already fired.
      if (signal.aborted) {
        return
      }

      const logger = app.resolve('logger')
      const teardown: Teardown = { admission: [], disposers: [] }
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

        const warnings = await startDaemonSubsystems({
          app,
          delivery,
          onHealth: options?.onHealth,
          startupSignal,
          startup,
          logger,
          tasks,
          state: taskState,
          teardown,
        })

        markReady({ app, delivery, logger, warnings, options })

        await abortWaiter.promise

        if (taskState.failure !== undefined) {
          throw taskState.failure
        }
      } catch (err: unknown) {
        throw toDaemonStartupError(err)
      } finally {
        startup.abort()
        abortWaiter.dispose()
        await shutdown({ app, teardown, logger, tasks })
      }
    },
  }
}

interface StartDaemonSubsystemsOptions {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly onHealth: DaemonStartOptions['onHealth']
  readonly startupSignal: AbortSignal
  readonly startup: AbortController
  readonly logger: Logger
  readonly tasks: Array<Promise<void>>
  readonly state: DaemonTaskState
  readonly teardown: Teardown
}

async function startDaemonSubsystems(
  options: StartDaemonSubsystemsOptions
): Promise<readonly DegradedItem[]> {
  const { app, delivery, startupSignal, startup, logger, tasks, state, teardown } = options
  const { disposers } = teardown
  const { onHealth } = options

  const channels = await startChannels(channelDeps(app, startupSignal))
  const tradingTasks = app.resolve('tradingServices').daemonTasks
  disposers.push(() => channels.stop())
  disposers.push(
    startScheduledWorkflows(
      {
        workflows: app.resolve('workflows'),
        logger,
        runner: app.resolve('runner'),
        config: app.config,
      },
      startupSignal
    )
  )

  attachDelivery({ delivery, channels, disposers })
  // Before `channels.stop()` in the teardown (disposers run in push order, and the channels were
  // pushed first), so the loop cannot announce a channel that is only being closed.
  disposers.unshift(
    startChannelWatch({
      delivery,
      locale: app.config.locale.language,
      logger,
      ...(onHealth === undefined ? {} : { onHealth }),
    })
  )

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
  for (const task of tradingTasks) {
    trackDaemonTask({ tasks, state, startup, name: task.name, task: task.start(startupSignal) })
  }

  disposers.push(startRetention(app, logger))
  disposers.push(startUpdateWatch(app, { logger, upgrade: app.resolve('selfUpgrade') }))
  disposers.push(startSocialUpkeep(app, logger))

  attachPluginTasks({ app, signal: startupSignal, startup, tasks, state })

  const apiSkipped = app.config.api.enabled ? await startApi(app, teardown) : []

  return [
    ...channels.skipped.map(
      ({ channel, error }): DegradedItem => ({
        kind: 'channel',
        subject: channel,
        message: error.operator,
      })
    ),
    ...apiSkipped,
  ]
}

// A token the operator named but cannot serve keeps the API closed; any other failure stops the start.
async function startApi(app: App, teardown: Teardown): Promise<readonly DegradedItem[]> {
  const logger = app.resolve('logger')

  try {
    const api = await app.resolve('apiStarter')(app, process.env)

    teardown.admission.push(api.closeAdmission)
    teardown.disposers.push(api.stop)
    logger.info('api.started', { port: app.config.api.port })

    return []
  } catch (err: unknown) {
    if (!(err instanceof ApiTokenError)) {
      throw err
    }

    logger.warn('api.token_unusable', { err: formatErrForLog(err) })

    return [{ kind: 'api', subject: 'api', message: err.operator }]
  }
}

function toDaemonStartupError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err
  }

  return new ConfigError('daemon startup failed', err)
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

/** Only now does a proactive notice have anywhere to go. Detached first on the way down, so nothing
 *  is queued against an adapter that is already closing. */
function attachDelivery(options: {
  readonly delivery: DeliveryHub
  readonly channels: StartChannelsResult
  readonly disposers: Disposer[]
}): void {
  const { delivery, channels } = options

  if (channels.notifier === undefined) {
    return
  }

  options.disposers.unshift(
    delivery.attach({
      notifier: channels.notifier,
      snapshots: channels.snapshots,
      isWorking: channels.isWorking,
      recipients: channels.recipients,
      recipient: channels.defaultRecipient,
      isDeliverable: channels.isDeliverable,
    })
  )
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
    operatorNotices: app.resolve('operatorNotices'),
    bus: app.resolve('bus'),
    logger: app.resolve('logger'),
    // Injected once here so no adapter reaches for process.env on its own.
    env: process.env,
    shutdownSignal: signal,
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

// Shed new work first (the API stops admitting before anything drains; its in-flight requests finish
// at its disposer), then drain in-flight runs (SHUTDOWN_DRAIN_MS to land), then dispose, then
// settle every task. The force timer throws
// through the process fatal boundary so its final diagnostic is flushed by the boot-owned logger
// before the process exits.
async function shutdown(options: {
  readonly app: App
  readonly teardown: Teardown
  readonly logger: Logger
  readonly tasks: readonly Promise<void>[]
}): Promise<void> {
  const { app, teardown, logger, tasks } = options
  const force = setTimeout(() => {
    throw new ConfigError('daemon shutdown exceeded its deadline')
  }, SHUTDOWN_TOTAL_MS)
  force.unref()

  try {
    for (const close of teardown.admission) {
      await runCleanup(logger, 'daemon.admission_failed', close)
    }

    await runCleanup(logger, 'daemon.pause_failed', () => app.resolve('sessionQueue').pause())
    await runCleanup(logger, 'daemon.drain_failed', () =>
      app.resolve('runRegistry').drain(SHUTDOWN_DRAIN_MS)
    )

    for (const dispose of teardown.disposers) {
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

function markReady(ready: {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly logger: Logger
  readonly warnings: readonly DegradedItem[]
  readonly options: DaemonStartOptions | undefined
}): void {
  const { app, delivery, logger, warnings, options } = ready

  logger.info('daemon.started')
  options?.onReady?.(warnings)
  reportUpgradeOutcome(app, logger)

  if (options?.previousRun !== undefined) {
    announceUncleanStop({ app, delivery, logger }, options.previousRun)
  }
}

/** The previous run died without stopping, so alerts and the brief were paused until now. Zalo
 *  Personal logs in after ready, so a Zalo-only setup can miss this one message; the upgrade
 *  outcome has the same limit. */
function announceUncleanStop(
  parts: { readonly app: App; readonly delivery: DeliveryHub; readonly logger: Logger },
  previousRun: { readonly startedAt?: number }
): void {
  const { app, delivery, logger } = parts
  const target = delivery.defaultRecipient()

  if (target === undefined) {
    logger.warn('daemon.unclean_stop_unannounced')

    return
  }

  const { language, timezone } = app.config.locale
  const params = { brand: BRAND.name }
  const text =
    previousRun.startedAt === undefined
      ? t(language, 'cli.daemonStoppedUnexpectedlyNoTime', params)
      : t(language, 'cli.daemonStoppedUnexpectedly', {
          ...params,
          started: formatInstant(language, previousRun.startedAt, timezone),
        })

  delivery
    .sendAcknowledged(target, { text }, { signal: app.signal })
    .catch((err: unknown) => formatErrForLog(err))
    .then((outcome) => {
      if (outcome !== 'accepted') {
        logger.warn('daemon.unclean_stop_notice_failed', { outcome })
      }
    })
}

/** Only once the daemon is ready: a release that dies late in its start must not tell the chat it
 *  arrived, and the upgrade child rolls it back before anyone is told otherwise. */
function reportUpgradeOutcome(app: App, logger: Logger): void {
  app
    .resolve('selfUpgrade')
    .announceOutcome()
    .catch((err: unknown) => {
      logger.warn('update.announce_crashed', { err: formatErrForLog(err) })
    })
}

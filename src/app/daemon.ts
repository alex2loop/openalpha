import type { DeliveryHub } from '@/app/delivery'
import type { App, DaemonStartOptions, DaemonTask, DegradedItem } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { refreshMarketDataOnBoot } from '@/app/boot-refresh'
import {
  type DaemonTaskState,
  startDaemonSubsystems,
  type Teardown,
  trackDaemonTask,
} from '@/app/daemon-subsystems'
import '@/app/events'
import { takeRestartMarker } from '@/app/restart-marker'
import { retentionCutoffAt, runWorkspaceTmpRetention } from '@/app/retention'
import { BRAND } from '@/core/brand'
import { AppError, ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'
import { formatInstant } from '@/trading/api'

/** How long a stop waits for the runs in flight before it disposes. */
export const SHUTDOWN_DRAIN_MS = 5_000
const SHUTDOWN_TOTAL_MS = 30_000

declare module '@/core/container' {
  interface Services {
    /** The whole daemon as one task: what `start` runs, and the only thing that owns the drain. */
    daemonTask: DaemonTask
  }
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

function toDaemonStartupError(err: unknown): AppError {
  if (err instanceof AppError) {
    return err
  }

  return new ConfigError('daemon startup failed', err)
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

    await runCleanup(logger, 'daemon.pause_failed', () => {
      app.resolve('sessionQueue').pause()
      app.resolve('commandLane').pause()
    })
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
  announceRestart(app, logger)

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

/** A restart asked for through the API leaves a marker, and only the daemon it brings up files the
 *  line to the bell. Taken here, not at boot: the helper and the `--background` parent boot in
 *  daemon mode too and would take it first. */
function announceRestart(app: App, logger: Logger): void {
  takeRestartMarker(app.config.paths.dataDir, Date.now())
    .then((restarted) => {
      if (restarted) {
        app.resolve('bus').emit('daemon_notice', {
          text: t(app.config.locale.language, 'ui.restartDone'),
          at: Date.now(),
        })
      }
    })
    .catch((err: unknown) => {
      logger.warn('daemon.restart_marker_failed', { err: formatErrForLog(err) })
    })
}

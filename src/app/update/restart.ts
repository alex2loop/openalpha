import type { RestartWhen } from '@/app/server/wire/vocab'
import type { App } from '@/core/container'
import type { BusEventMap } from '@/core/events'
import { clearRestartMarker, writeRestartMarker } from '@/app/update/restart-marker'
import { spawnRestartProcess } from '@/cli/api'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE, MS_PER_SECOND, sleep } from '@/core/utils/time'
import { t } from '@/i18n'

/** The longest an `idle` restart waits for the daemon to go quiet before it restarts anyway. */
export const RESTART_IDLE_WAIT_MS = 2 * MS_PER_MINUTE
const RESTART_IDLE_POLL_MS = MS_PER_SECOND

export const RESTART_WHEN = ['idle', 'now'] as const satisfies readonly RestartWhen[]

/** `busy`: a restart or an upgrade is already under way. `stopping`: this daemon is shutting down.
 *  `foreground`: it runs in a terminal or under a service, which is not ours to restart. */
export type RestartStart = 'started' | 'busy' | 'stopping' | 'foreground'

/** One restart request: what it asked for, and when it was asked, epoch ms. */
export interface RestartRequest {
  readonly when: RestartWhen
  readonly requestedAt: number
}

interface RestartRun extends RestartRequest {
  readonly app: App
  readonly isWorking: () => boolean
  /** The helper is running and will stop this daemon. */
  readonly onSpawned: () => void
  /** The helper exited while this daemon still runs: nothing was restarted. */
  readonly onFailed: () => void
}

/** The marker goes down before the helper starts, so the daemon it brings up knows it was a restart.
 *  A marker that cannot be written, or a helper that cannot start, is a restart that did not happen. */
export async function runRestart(run: RestartRun): Promise<void> {
  const { app } = run

  if (run.when === 'idle' && !(await waitUntilIdle(app, run.isWorking))) {
    logRestart(app, run, 'aborted')

    return
  }

  try {
    await startHelper(run)
  } catch (err: unknown) {
    app.resolve('logger').error('update.restart_start_failed', { err: formatErrForLog(err) })
    logRestart(app, run, 'error')
    notifyFailed(app)
    await clearRestartMarker(app.config.paths.dataDir).catch(() => {
      // The marker expires on its own, and takeRestartMarker ignores a stale one.
    })
  }
}

async function startHelper(run: RestartRun): Promise<void> {
  const { app } = run
  const { dataDir } = app.config.paths

  await writeRestartMarker(dataDir, Date.now())

  // A stop that came in meanwhile must stay a stop: the helper would start the daemon again.
  if (app.signal.aborted) {
    await clearRestartMarker(dataDir)
    logRestart(app, run, 'aborted')

    return
  }

  const child = await spawnRestartProcess(app)
  const stopWatching = logWhenStopping(run)

  run.onSpawned()
  child.exited
    .then(async (code) => {
      stopWatching()

      // A daemon the helper stopped reports nothing: the new one is already up.
      if (app.signal.aborted) {
        return
      }

      await reportHelperExit(run, code)
    })
    .catch((err: unknown) => {
      app.resolve('logger').warn('update.restart_report_failed', { err: formatErrForLog(err) })
    })
}

// The helper exited while this daemon still runs: nothing was restarted.
async function reportHelperExit(run: RestartRun, code: number): Promise<void> {
  const { app } = run

  app.resolve('logger').error('update.restart_failed', { code })
  logRestart(app, run, 'error')
  notifyFailed(app)
  // Cleared first: once `onFailed` runs, a second restart may write its own marker.
  try {
    await clearRestartMarker(app.config.paths.dataDir)
  } finally {
    run.onFailed()
  }
}

/** The helper stopping this daemon is the restart working, so that is when it is logged. Returns the
 *  release of the watch, for a helper that exits first. */
function logWhenStopping(run: RestartRun): () => void {
  const { app } = run
  const onStopping = (): void => logRestart(app, run, 'completed')

  if (app.signal.aborted) {
    onStopping()

    return () => undefined
  }

  app.signal.addEventListener('abort', onStopping, { once: true })

  return () => app.signal.removeEventListener('abort', onStopping)
}

/** Files the request's one activity row, whichever way it ended. */
export function logRestart(
  app: App,
  request: RestartRequest,
  outcome: BusEventMap['restart_ended']['outcome']
): void {
  app.resolve('bus').emit('restart_ended', { ...request, outcome })
}

// The restart was accepted with a 202 and the page is waiting for a new pid, so a failure that is
// only logged leaves it waiting for good: the bell says it did not happen.
function notifyFailed(app: App): void {
  app.resolve('bus').emit('daemon_notice', {
    text: t(app.config.locale.language, 'ui.restartFailed'),
    at: Date.now(),
    kind: 'restart-failed',
  })
}

/** False when the daemon began shutting down first. A quiet daemon, or the deadline, ends the wait;
 *  `sleep` clears its timer on abort, so nothing outlives a shutdown. */
async function waitUntilIdle(app: App, isWorking: () => boolean): Promise<boolean> {
  const deadline = performance.now() + RESTART_IDLE_WAIT_MS

  try {
    while (isWorking() && performance.now() < deadline) {
      await sleep(Math.min(RESTART_IDLE_POLL_MS, deadline - performance.now()), app.signal)
    }
  } catch (err: unknown) {
    if (app.signal.aborted) {
      return false
    }

    throw err
  }

  return !app.signal.aborted
}

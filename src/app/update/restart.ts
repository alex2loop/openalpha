import type { RestartWhen } from '@/app/server/wire/vocab'
import type { App } from '@/core/container'
import { clearRestartMarker, writeRestartMarker } from '@/app/restart-marker'
import { spawnRestartProcess } from '@/cli/api'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_MINUTE, MS_PER_SECOND, sleep } from '@/core/utils/time'

/** The longest an `idle` restart waits for the daemon to go quiet before it restarts anyway. */
export const RESTART_IDLE_WAIT_MS = 2 * MS_PER_MINUTE
const RESTART_IDLE_POLL_MS = MS_PER_SECOND

export const RESTART_WHEN = ['idle', 'now'] as const satisfies readonly RestartWhen[]

/** `busy`: a restart or an upgrade is already under way. `stopping`: this daemon is shutting down.
 *  `foreground`: it runs in a terminal or under a service, which is not ours to restart. */
export type RestartStart = 'started' | 'busy' | 'stopping' | 'foreground'

interface RestartRun {
  readonly app: App
  readonly when: RestartWhen
  readonly isWorking: () => boolean
  /** The helper is running and will stop this daemon. */
  readonly onSpawned: () => void
  /** The helper exited while this daemon still runs: nothing was restarted. */
  readonly onFailed: () => void
}

/** The marker goes down before the helper starts, so the daemon it brings up knows it was a restart.
 *  A marker that cannot be written, or a helper that cannot start, is a restart that did not happen. */
export async function runRestart(run: RestartRun): Promise<void> {
  const { app, when, isWorking } = run
  const { dataDir } = app.config.paths
  const logger = app.resolve('logger')

  if (when === 'idle' && !(await waitUntilIdle(app, isWorking))) {
    return
  }

  try {
    await writeRestartMarker(dataDir, Date.now())

    // A stop that came in meanwhile must stay a stop: the helper would start the daemon again.
    if (app.signal.aborted) {
      await clearRestartMarker(dataDir)

      return
    }

    const child = await spawnRestartProcess(app)

    run.onSpawned()
    child.exited
      .then(async (code) => {
        // A daemon the helper stopped reports nothing: the new one is already up.
        if (app.signal.aborted) {
          return
        }

        logger.error('update.restart_failed', { code })
        // Cleared first: once `onFailed` runs, a second restart may write its own marker.
        try {
          await clearRestartMarker(dataDir)
        } finally {
          run.onFailed()
        }
      })
      .catch((err: unknown) => {
        logger.warn('update.restart_report_failed', { err: formatErrForLog(err) })
      })
  } catch (err: unknown) {
    logger.error('update.restart_start_failed', { err: formatErrForLog(err) })
    await clearRestartMarker(dataDir).catch(() => {
      // The marker expires on its own, and takeRestartMarker ignores a stale one.
    })
  }
}

/** False when the daemon began shutting down first. A quiet daemon, or the deadline, ends the wait;
 *  `sleep` clears its timer on abort, so nothing outlives a shutdown. */
async function waitUntilIdle(app: App, isWorking: () => boolean): Promise<boolean> {
  const deadline = Date.now() + RESTART_IDLE_WAIT_MS

  try {
    while (isWorking() && Date.now() < deadline) {
      await sleep(Math.min(RESTART_IDLE_POLL_MS, deadline - Date.now()), app.signal)
    }
  } catch (err: unknown) {
    if (app.signal.aborted) {
      return false
    }

    throw err
  }

  return !app.signal.aborted
}

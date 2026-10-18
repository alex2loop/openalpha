import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { isUpdateCheckEnabled, newerVersionOf, refreshUpdateState } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'

const UPDATE_WATCH_INTERVAL_MS = MS_PER_DAY

/** Logs a newer release on start and once a day. A channel hears of it only at the foot of the
 *  morning brief (`readUpdateLine`): it carries signals, not maintenance notices. */
export function startUpdateWatch(app: App, logger: Logger): () => Promise<void> {
  const controller = new AbortController()
  let inFlight: Promise<void> | null = null

  const check = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = logNewerRelease(app, logger, controller.signal)
      .catch((err: unknown) => {
        logger.warn('update.check_failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(check, UPDATE_WATCH_INTERVAL_MS)
  timer.unref()
  check()

  return async () => {
    clearInterval(timer)
    controller.abort()

    if (inFlight !== null) {
      await inFlight
    }
  }
}

async function logNewerRelease(app: App, logger: Logger, signal: AbortSignal): Promise<void> {
  if (!(await isUpdateCheckEnabled(app.config))) {
    return
  }

  const state = await refreshUpdateState({
    dataDir: app.config.paths.dataDir,
    now: Date.now(),
    signal,
  })
  const latest = newerVersionOf(state)

  if (latest !== null) {
    logger.info('update.available', { current: BRAND.version, latest })
  }
}

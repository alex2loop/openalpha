import type { SelfUpgrade } from '@/app/update/install'
import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { isUpdateCheckEnabled, newerVersionOf, refreshUpdateState } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY } from '@/core/utils/time'

const UPDATE_WATCH_INTERVAL_MS = MS_PER_DAY

interface UpdateWatchOptions {
  readonly logger: Logger
  readonly upgrade: SelfUpgrade
}

/** Logs a newer release on start and once a day, and reports how an upgrade started from chat
 *  ended. A channel hears of a release only at the foot of the morning brief (`readUpdateLine`) and
 *  in the operator's private chat: alerts carry signals, not maintenance notices. */
export function startUpdateWatch(app: App, options: UpdateWatchOptions): () => Promise<void> {
  const { logger } = options
  const controller = new AbortController()
  let inFlight: Promise<void> | null = null
  let reported = false

  const check = (): void => {
    if (inFlight !== null) {
      return
    }

    const announce = !reported
    reported = true
    inFlight = runUpdateCheck(app, { ...options, announce, signal: controller.signal })
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

async function runUpdateCheck(
  app: App,
  options: UpdateWatchOptions & { readonly announce: boolean; readonly signal: AbortSignal }
): Promise<void> {
  // Ahead of the checks-on guard: an upgrade started from chat reports back even if checks were
  // turned off since.
  if (options.announce) {
    await options.upgrade.announceOutcome()
  }

  await logNewerRelease(app, options.logger, options.signal)
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

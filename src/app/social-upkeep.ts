import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { formatErrForLog } from '@/core/security/credentials'
import { SOCIAL_UPKEEP_INTERVAL_MS } from '@/social/api'

/** Checks every added network's skill for changes and prunes the social tables: once at start, then
 *  once a day. Never applies a change; it only stages one and says so. */
export function startSocialUpkeep(app: App, logger: Logger): () => Promise<void> {
  const service = app.resolve('socialService')
  const controller = new AbortController()
  let inFlight: Promise<void> | null = null

  const run = (): void => {
    if (inFlight !== null) {
      return
    }

    inFlight = service
      .upkeep(controller.signal)
      .catch((err: unknown) => {
        logger.warn('social.upkeep_failed', { err: formatErrForLog(err) })
      })
      .finally(() => {
        inFlight = null
      })
  }

  const timer = setInterval(run, SOCIAL_UPKEEP_INTERVAL_MS)
  timer.unref()
  run()

  return async () => {
    clearInterval(timer)
    controller.abort()

    if (inFlight !== null) {
      await inFlight
    }
  }
}

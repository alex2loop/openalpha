import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { settleWithin } from '@/core/utils/concurrency'
import { isBoundaryFailure, logRefreshDegradations, refreshDegradations } from '@/trading/api'

const BOOT_REFRESH_BUDGET_MS = 60_000

interface BootRefreshOptions {
  readonly app: App
  readonly logger: Logger
  readonly signal: AbortSignal
  /** Hands an unfinished sweep to the daemon's task tracker: a detached failure must still reach
   *  the same fatal boundary as any other daemon task. */
  track(task: Promise<void>): void
}

/** Bounded synchronous phase, detached completion. The sweeper is never aborted on timeout - an
 *  aborted kind writes no attempt row, so the next tick would redo the whole scope; detaching gets
 *  freshness eventually and correctness always. The coordinator's in-flight map joins any later
 *  `trading.refresh` tick to this same sweep, so no second guard is needed here. */
export async function refreshMarketDataOnBoot(options: BootRefreshOptions): Promise<boolean> {
  const { app, logger, signal } = options
  const completion = app
    .resolve('tradingServices')
    .refreshMarketData({ signal })
    .then((results) => {
      const degradations = refreshDegradations(results)

      if (degradations.length > 0) {
        logRefreshDegradations({ logger, forced: false, degradations })
      }
    })

  if (await settleWithin(completion, BOOT_REFRESH_BUDGET_MS)) {
    try {
      await completion
      return true
    } catch (err: unknown) {
      if (isAbortError(err)) {
        return false
      }

      throw err
    }
  }

  logger.warn('daemon.boot_refresh_timeout', { budgetMs: BOOT_REFRESH_BUDGET_MS })

  // A provider outage at boot degrades; anything else is this code being wrong and must surface
  // through the fatal task tracker like any daemon task failure.
  const drained = completion.catch((err: unknown) => {
    if (isAbortError(err)) {
      return
    }

    if (isBoundaryFailure(err)) {
      logger.warn('daemon.boot_refresh_failed', { err: formatErrForLog(err) })
      return
    }

    throw err
  })

  options.track(drained)

  return true
}

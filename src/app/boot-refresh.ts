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
}

/** One sweep of every market in use, run beside the rest of the start. The loops that read market
 *  data wait for it through `releaseFirstSweep`, which is called when the sweep has settled, when
 *  the budget runs out, or on abort, so a stuck provider never holds them. The sweeper is never
 *  aborted on timeout - an aborted kind writes no attempt row, so the next tick would redo the
 *  whole scope - so the sweep carries on and the coordinator's in-flight map joins any later
 *  `trading.refresh` tick to it.
 *
 *  A provider outage degrades the same way inside the budget or after it: warn and carry on.
 *  Anything else is this code being wrong and rejects, for the daemon's task tracker to make fatal. */
export async function runBootRefresh(options: BootRefreshOptions): Promise<void> {
  const { app, logger, signal } = options
  const trading = app.resolve('tradingServices')
  const sweep = sweepMarketData(app, logger, signal)

  try {
    if (!(await settleWithin(sweep, BOOT_REFRESH_BUDGET_MS))) {
      logger.warn('daemon.boot_refresh_timeout', { budgetMs: BOOT_REFRESH_BUDGET_MS })
      trading.releaseFirstSweep()
    }

    await sweep
  } finally {
    trading.releaseFirstSweep()
  }
}

async function sweepMarketData(app: App, logger: Logger, signal: AbortSignal): Promise<void> {
  try {
    const results = await app
      .resolve('tradingServices')
      .refreshMarketData({ signal, scheduled: true })
    const degradations = refreshDegradations(results)

    if (degradations.length > 0) {
      logRefreshDegradations({ logger, forced: false, degradations })
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      return
    }

    if (!isBoundaryFailure(err)) {
      throw err
    }

    logger.warn('daemon.boot_refresh_failed', { err: formatErrForLog(err) })
  }
}

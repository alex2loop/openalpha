import type { App } from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { isAbortError } from '@/core/errors'
import { isBoundaryFailure, logRefreshDegradations, refreshDegradations } from '@/trading/api'

interface MarketSweep {
  readonly app: App
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** One scheduled refresh of the markets in use, for the daemon's boot and the browser's upkeep. A
 *  degraded result is logged; an abort ends it quietly; a failure of the outside world (a provider,
 *  the storage) goes to `onBoundaryFailure`, which logs it under its caller's own key or rethrows;
 *  anything else is this code being wrong and rejects. */
export async function refreshMarketsInUse(
  sweep: MarketSweep,
  onBoundaryFailure: (err: unknown) => void
): Promise<void> {
  const { app, logger, signal } = sweep

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

    onBoundaryFailure(err)
  }
}

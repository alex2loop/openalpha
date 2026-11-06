import type { Logger } from '@/core/logging/logger'
import type { ScreenView } from '@/trading/features/market-data/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import { logScreen } from '@/trading/features/market-data/ops/screen-log'
import { withPrices } from '@/trading/features/market-data/ops/screen-prices'
import { resolveDay } from '@/trading/features/market-data/resolve'

interface BookFreeScreenDeps {
  readonly markets: MarketRegistry
  readonly logger: Logger
}

interface BookFreeScreenRequest {
  readonly market: MarketRef
  readonly limit: number
  readonly now: number
  readonly signal: AbortSignal
}

/** A market's ranked board with live prices and nothing of the operator's: no exclusion mark, no
 *  margin mark, no read of the venues the operator trades on, and no refresh, because the caller
 *  refreshed the market first. Undefined for a market that has no screen. */
export async function runBookFreeScreen(
  deps: BookFreeScreenDeps,
  request: BookFreeScreenRequest
): Promise<ScreenView | undefined> {
  const market = deps.markets.find(request.market)

  if (market === null || market.capabilities.screen === undefined) {
    return undefined
  }

  const { now, signal } = request
  const result = await market.capabilities.screen.run({
    market: request.market,
    limit: request.limit,
    asOf: resolveDay(market, now),
    now,
    signal,
    venueBlind: true,
  })

  logScreen(deps.logger, request, result)

  return {
    ...result,
    currency: market.manifest.currency,
    candidates: await withPrices(market, result.candidates, request),
  }
}

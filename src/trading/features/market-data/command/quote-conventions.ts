import type { MarketDataService } from '@/trading/features/market-data/types'
import type { InstrumentRef, MarketRef } from '@/trading/kernel/instrument'
import type { QuoteConvention } from '@/trading/render/money'

/** One entry per market the rows touch, resolved in the command because a renderer cannot reach
 *  the registry and only the registry knows how a venue prints a price. A market the registry does
 *  not list is simply absent, and its rows print the raw quote. */
export function quoteConventionsFor(
  marketData: Pick<MarketDataService, 'quoteConvention'>,
  instruments: readonly Pick<InstrumentRef, 'market'>[]
): ReadonlyMap<MarketRef, QuoteConvention> {
  const conventions = new Map<MarketRef, QuoteConvention>()

  for (const market of new Set(instruments.map((instrument) => instrument.market))) {
    const convention = marketData.quoteConvention(market)

    if (convention !== undefined) {
      conventions.set(market, convention)
    }
  }

  return conventions
}

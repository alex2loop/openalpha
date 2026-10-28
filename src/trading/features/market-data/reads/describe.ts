import type { MarketDataService, MarketDescription } from '@/trading/features/market-data/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { Market } from '@/trading/markets/types'

/** One market as a surface lays it out: where it trades, its index, and the reads it answers. */
export function describeMarket(market: Market): MarketDescription {
  const { manifest, capabilities } = market
  const { hours } = manifest.calendar

  return {
    market: manifest.id,
    region: manifest.region,
    ownsRegion: manifest.ownsRegion,
    segment: manifest.segment,
    currency: manifest.currency,
    icon: manifest.icon,
    ...(manifest.benchmark === undefined ? {} : { benchmark: manifest.benchmark }),
    ...(hours === undefined ? {} : { session: hours }),
    hasBoard: capabilities.screen !== undefined,
    hasBrief: capabilities.brief !== undefined,
    hasEvents: capabilities.events !== undefined,
    hasIndexes:
      capabilities.indexContributors !== undefined && capabilities.indexValuation !== undefined,
  }
}

/** Each market's own icon, so a rule naming a market wears the same mark on every surface. */
export function resolveMarketIcons(
  marketData: Pick<MarketDataService, 'describeMarkets'>
): ReadonlyMap<MarketRef, string> {
  return new Map(marketData.describeMarkets().map((market) => [market.market, market.icon]))
}

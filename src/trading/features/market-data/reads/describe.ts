import type { MarketDescription } from '@/trading/features/market-data/types'
import type { Market } from '@/trading/markets/types'

/** One market as a surface lays it out: where it trades, its index, and the reads it answers. */
export function describeMarket(market: Market): MarketDescription {
  const { manifest, capabilities } = market

  return {
    market: manifest.id,
    region: manifest.region,
    ownsRegion: manifest.ownsRegion,
    segment: manifest.segment,
    currency: manifest.currency,
    icon: manifest.icon,
    ...(manifest.benchmark === undefined ? {} : { benchmark: manifest.benchmark }),
    hasBoard: capabilities.screen !== undefined,
    hasBrief: capabilities.brief !== undefined,
    hasEvents: capabilities.events !== undefined,
  }
}

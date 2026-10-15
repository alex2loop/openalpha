import type { CaveatCode } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { ScreenResult, SectorStrengthResult } from '@/trading/kernel/market/market-capability'
import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type { Market } from '@/trading/markets/types'

/** A market that does not publish the capability at all. Distinct from an empty result, which
 *  means the capability ran and found nothing — reporting the two the same way blames a market's
 *  data for a feature it never offered. */
export function unsupportedOverview(market: Market, asOf: TradingDay): MarketDataOverview {
  return emptyOverview(market, asOf, 'market-data.overview-unsupported')
}

/** A market whose overview read threw; it degrades alone, never emptying the rest. */
export function failedOverview(market: Market, asOf: TradingDay): MarketDataOverview {
  return emptyOverview(market, asOf, 'market-data.overview-failed')
}

export function unsupportedSectors(asOf: TradingDay): SectorStrengthResult {
  return {
    asOf,
    sectors: [],
    provenance: [],
    caveats: [{ code: 'market-data.sectors-unsupported' }],
  }
}

export function unsupportedScreen(asOf: TradingDay): ScreenResult {
  return {
    asOf,
    candidates: [],
    rejections: [],
    universeSize: 0,
    provenance: [],
    caveats: [{ code: 'market-data.screen-unsupported' }],
  }
}

function emptyOverview(market: Market, asOf: TradingDay, code: CaveatCode): MarketDataOverview {
  return {
    market: market.manifest.id,
    asOf,
    currency: market.manifest.currency,
    icon: market.manifest.icon,
    rows: [],
    provenance: [],
    caveats: [{ code }],
  }
}

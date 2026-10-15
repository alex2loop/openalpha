import type { MarketDataOverview } from '@/trading/kernel/market/market-overview'
import type {
  BriefSectionKind,
  BriefSectionResult,
  BriefSectionRow,
} from '@/trading/kernel/operator/brief-section'

interface ReadySection {
  readonly kind: BriefSectionKind
  readonly rows: readonly BriefSectionRow[]
  readonly titleParams?: Readonly<Record<string, string | number>>
}

/** One group of what a market published, carrying the session it describes and the currency its
 *  money is denominated in. Provenance and caveats stay empty: they describe the whole read rather
 *  than any one group, so the surface decides where to state them. */
export function readySection(
  overview: MarketDataOverview,
  section: ReadySection
): BriefSectionResult {
  return { ...openSection(overview, section), currency: overview.currency }
}

/** The prices block, whose currency is what its prices are quoted in rather than what this market's
 *  money is. The two differ wherever a market publishes levels: an index is a number, and stamping
 *  it `VND` states a denomination it does not have. */
export function priceSection(
  overview: MarketDataOverview,
  rows: readonly BriefSectionRow[]
): BriefSectionResult {
  return {
    ...openSection(overview, { kind: 'market-prices', rows }),
    ...(overview.priceCurrency === undefined ? {} : { currency: overview.priceCurrency }),
  }
}

function openSection(
  overview: MarketDataOverview,
  { kind, rows, titleParams }: ReadySection
): Omit<Extract<BriefSectionResult, { status: 'ready' }>, 'currency'> {
  return {
    kind,
    market: overview.market,
    icon: overview.icon,
    asOf: overview.asOf,
    status: 'ready',
    rows,
    ...(titleParams === undefined ? {} : { titleParams }),
    provenance: [],
    caveats: [],
  }
}

/** A market whose read failed still appears in its own block, saying why — distinct from a market
 *  that published nothing. */
export function unavailableSection(overview: MarketDataOverview): BriefSectionResult {
  return {
    kind: 'market-quotes',
    market: overview.market,
    icon: overview.icon,
    asOf: overview.asOf,
    status: 'unavailable',
    caveats: overview.caveats,
  }
}

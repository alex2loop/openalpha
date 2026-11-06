import type { InstrumentRef, MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { Market } from '@/trading/markets/types'

/** What the operator already uses. A bare ticker one of the instruments carries names that
 *  instrument's market, so a symbol two markets list resolves to the side the operator uses. A
 *  market whose segment is switched off and which holds nothing of theirs is not asked for a bare
 *  ticker at all: a coin symbol that is also a stock there is never read as the stock. Its prefix
 *  still reaches it. */
export interface OperatorUse {
  /** What the operator holds or watches. */
  readonly instruments: readonly InstrumentRef[]
  /** Segments a venue holds that the operator switched off. A segment no venue holds (world gold) is
   *  never in it: it was never theirs to switch off, and its names stay readable. */
  readonly switchedOff: ReadonlySet<PortfolioSegment>
}

export type ReadOperatorUse = (signal: AbortSignal) => Promise<OperatorUse>

export const NOTHING_USED: OperatorUse = Object.freeze({
  instruments: [],
  switchedOff: new Set<PortfolioSegment>(),
})

export function nothingUsed(): Promise<OperatorUse> {
  return Promise.resolve(NOTHING_USED)
}

/** The markets a bare ticker never reaches: segment switched off, nothing held or watched there. */
export function unusedMarkets(markets: readonly Market[], use: OperatorUse): readonly MarketRef[] {
  return markets
    .filter(
      (market) =>
        use.switchedOff.has(market.manifest.segment) &&
        !use.instruments.some((ref) => ref.market === market.manifest.id)
    )
    .map((market) => market.manifest.id)
}

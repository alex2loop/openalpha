import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, MarketRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { Market, MarketResolution, ResolveMarketOptions } from '@/trading/markets/types'

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

/** A bare ticker the operator typed never reaches a switched-off market, so the answer names the
 *  ones that could list it, with the prefix that reaches one. On a resolved name it rides apart from
 *  the caveats, for a read that comes back empty to print. */
export function withSwitchedOffNote(
  resolution: MarketResolution,
  skipped: readonly Market[],
  options: ResolveMarketOptions
): MarketResolution {
  const possible = skipped.filter((market) => market.candidacy(options.ticker) === 'possible')
  const [first] = possible

  if (first === undefined || options.market !== undefined || options.operatorRead !== true) {
    return resolution
  }

  const note: Caveat = {
    code: 'market.switched-off',
    detail: {
      ticker: options.ticker,
      markets: possible.map((market) => market.manifest.id).join(', '),
      marketId: first.manifest.id,
      segmentId: first.manifest.segment,
    },
  }

  return resolution.kind === 'resolved'
    ? { ...resolution, unavailableCaveats: [note] }
    : { ...resolution, caveats: [...resolution.caveats, note] }
}

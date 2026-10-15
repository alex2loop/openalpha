import type { PortfolioSegment, Ticker } from '@/trading/kernel/instrument'

/** A ceiling the operator set that proposed buying would cross. Weights are fractions of NAV, as
 *  every `*PctNav` in the trading tree is. Four arms rather than one subject field, because each
 *  names its subject differently: a ticker prints as itself, a sector is a provider's own string,
 *  a segment is a registered id the catalog has a name for, and the ETF sub-cap bounds a share of a
 *  segment rather than the segment itself. */
export type SleeveBreach =
  | {
      readonly kind: 'position'
      readonly ticker: Ticker
      readonly combinedPctNav: number
      readonly capPctNav: number
    }
  | {
      readonly kind: 'sector'
      readonly sector: string
      readonly combinedPctNav: number
      readonly capPctNav: number
    }
  | {
      readonly kind: 'segment'
      readonly segment: PortfolioSegment
      readonly combinedPctNav: number
      readonly capPctNav: number
    }
  | {
      readonly kind: 'etf'
      readonly segment: PortfolioSegment
      readonly combinedPctNav: number
      readonly capPctNav: number
    }

/** A cap at or below zero is a sleeve the sizer already refused, so nothing sized could have landed
 *  there and a "breach" of it would be arithmetic on a limit nobody hit. */
export function isBreached(combinedPctNav: number, capPctNav: number): boolean {
  return capPctNav > 0 && combinedPctNav > capPctNav
}

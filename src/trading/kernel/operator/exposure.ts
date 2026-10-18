import type { PortfolioSegment, Ticker } from '@/trading/kernel/instrument'

/** A ceiling the operator set that proposed buying would cross. Weights are fractions of NAV, as
 *  every `*PctNav` in the trading tree is. Five arms rather than one subject field, because each
 *  names its subject differently: a ticker prints as itself, a sector is a provider's own string,
 *  a segment is a registered id the catalog has a name for, and the ETF sub-cap bounds a share of a
 *  segment rather than the segment itself. `etf-unmeasured` is that sub-cap where the share cannot
 *  be read: it carries no combined weight, because none exists to state. */
export type CapBreach =
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
  | {
      readonly kind: 'etf-unmeasured'
      readonly segment: PortfolioSegment
      readonly capPctNav: number
    }

/** A cap at or below zero is a segment the sizer already refused, so nothing sized could have landed
 *  there and a "breach" of it would be arithmetic on a limit nobody hit. */
export function isBreached(combinedPctNav: number, capPctNav: number): boolean {
  return capPctNav > 0 && combinedPctNav > capPctNav
}

/** A segment holding a priced position whose kind never resolved: its ETF share cannot be read, so
 *  every ETF ceiling over it has no room. A segment the book holds nothing in is measured, at zero. */
export function isEtfUnmeasured(segment: { readonly etfPctNav?: number } | undefined): boolean {
  return segment !== undefined && segment.etfPctNav === undefined
}

interface EtfBreachInput {
  readonly segment: PortfolioSegment
  /** The segment's row of the valued book, absent where the book holds nothing there. A row whose
   *  `etfPctNav` is absent is a segment with a priced holding of no resolved kind. */
  readonly segmentValue: { readonly etfPctNav?: number } | undefined
  /** What this order, or this batch's net buys, add to the segment's ETF share. */
  readonly addedPctNav: number
  /** The segment's declared ETF ceiling; absent where it declares none. */
  readonly ceilingPctNav: number | undefined
}

/** The one reading of the ETF sub-cap, so a single order and a batch cannot disagree about it. A
 *  segment whose ETF share cannot be measured has no room under a declared ceiling, as in
 *  `etfCeilingPctNav`; that is its own arm rather than a cap of zero, which `isBreached` would read
 *  as no ceiling at all. */
export function etfBreaches(input: EtfBreachInput): readonly CapBreach[] {
  const { segment, segmentValue, ceilingPctNav } = input

  if (ceilingPctNav === undefined) {
    return []
  }

  if (isEtfUnmeasured(segmentValue)) {
    return ceilingPctNav > 0 ? [{ kind: 'etf-unmeasured', segment, capPctNav: ceilingPctNav }] : []
  }

  const combinedPctNav = (segmentValue?.etfPctNav ?? 0) + input.addedPctNav

  return isBreached(combinedPctNav, ceilingPctNav)
    ? [{ kind: 'etf', segment, combinedPctNav, capPctNav: ceilingPctNav }]
    : []
}

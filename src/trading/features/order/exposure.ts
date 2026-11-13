import type { UnmirroredExposure } from '@/trading/features/order/store/order-intent'
import type { ValuedBook } from '@/trading/features/portfolio/types'
import type { InstrumentKind, InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { CapBreach, ShownBreach } from '@/trading/kernel/operator/exposure'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import type { MarketRegistry } from '@/trading/markets/types'
import { OrderError } from '@/trading/features/order/types'
import { ETF_KIND, isSameInstrument } from '@/trading/kernel/instrument'
import { etfBreaches, isBreached, toShownBreach } from '@/trading/kernel/operator/exposure'
import { isSegmentDisabled, positionCapOf } from '@/trading/kernel/operator/profile'

/** What the write window forgives a ceiling by, as a fraction of NAV. Sizing lands a buy right at
 *  its cap, and the book is priced again seconds later, so a tick would otherwise turn an order the
 *  operator approved into a breach. */
export const RECHECK_TOLERANCE_PCT_NAV = 0.0005

interface OrderExposureInput {
  /** None saved declares no ceilings, so a buy without one is measured against nothing. */
  readonly profile: UserProfile | null
  readonly book: ValuedBook
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  /** Buys that placed at the exchange and never reached the ledger: the book cannot weigh them, so
   *  the position and segment ceilings add them to what it holds. */
  readonly unmirrored: UnmirroredExposure['buys']
  /** Files an unmirrored buy under its segment; a market it no longer finds counts toward no
   *  segment, and toward the position ceiling only by instrument. */
  readonly markets: Pick<MarketRegistry, 'find'>
  /** Absent where the market publishes none, which leaves the segment's ETF ceiling unmeasured
   *  rather than assuming the name is not one. */
  readonly instrumentKind?: InstrumentKind
  /** The order's value in the book's own currency, as the caps beside it are measured. */
  readonly notionalBase: number
  /** The breaches the operator was shown when the order was staged; the re-check refuses a ceiling
   *  that is not among them, or that has grown past the weight shown by more than the tolerance. */
  readonly accepted?: readonly ShownBreach[]
  /** How far past a positive ceiling a weight may land and still hold, as a fraction of NAV. Only
   *  the write window sets it; a ceiling of zero is a closed bucket and takes none. */
  readonly tolerancePctNav?: number
}

interface MeasuredOrder extends OrderExposureInput {
  readonly profile: UserProfile
}

/** A buy against a saved profile is judged by weights of NAV, and a book with an unpriced holding
 *  has no NAV: every ceiling would go unmeasured and the order would clear them all. Refused
 *  instead, in the direction the portfolio's own policy errs. No profile declares no ceilings, so
 *  a buy without one is left alone, and a sell takes exposure off. */
export function assertBookPriced(book: ValuedBook, profile: UserProfile | null): void {
  if (profile !== null && book.navBase === undefined) {
    throw new OrderError(
      'order.book_unpriced',
      'a holding has no price, so the caps cannot be read'
    )
  }
}

/** Where a buy would leave the ceilings this path can see without a second lookup. The sector cap
 *  is not among them: a name's sector needs a provider read the order path does not make, and a
 *  network call on the confirmation prompt is worse than a limit stated one short. It is still
 *  reported once the fill is booked, by the ledger fold `/portfolio` and `/rebalance` read. */
export function breachedCaps(order: OrderExposureInput): readonly CapBreach[] {
  const { profile } = order
  const navBase = order.book.navBase

  // No denominator, no weights. `assertBookPriced` has already refused an unpriced book, so what
  // is left is a book worth nothing, which a ratio cannot be taken against either.
  if (profile === null || navBase === undefined || navBase <= 0) {
    return []
  }

  const input: MeasuredOrder = { ...order, profile }
  const addedPctNav = input.notionalBase / navBase
  const shown = new Map((input.accepted ?? []).map((seen) => [seen.subject, seen]))
  const tolerancePctNav = input.tolerancePctNav ?? 0

  return [
    ...positionBreach(input, addedPctNav, navBase),
    ...segmentBreach(input, addedPctNav, navBase),
    ...etfBreach(input, addedPctNav),
  ].filter(
    (breach) =>
      !(isStillShown(breach, shown, tolerancePctNav) || isWithinTolerance(breach, tolerancePctNav))
  )
}

/** A shown ceiling passes at the weight it was shown, give or take the tolerance: past that the
 *  operator confirmed a smaller breach than the one this would be. A shown weight that was never
 *  kept cannot be compared, so it refuses. */
function isStillShown(
  breach: CapBreach,
  shown: ReadonlyMap<string, ShownBreach>,
  tolerancePctNav: number
): boolean {
  const seen = shown.get(toShownBreach(breach).subject)

  if (seen === undefined) {
    return false
  }

  if (breach.kind === 'etf-unmeasured') {
    return true
  }

  return (
    seen.combinedPctNav !== undefined &&
    breach.combinedPctNav <= seen.combinedPctNav + tolerancePctNav
  )
}

function isWithinTolerance(breach: CapBreach, tolerancePctNav: number): boolean {
  return (
    breach.kind !== 'etf-unmeasured' &&
    breach.capPctNav > 0 &&
    breach.combinedPctNav - breach.capPctNav <= Math.min(tolerancePctNav, breach.capPctNav)
  )
}

function positionBreach(
  input: MeasuredOrder,
  addedPctNav: number,
  navBase: number
): readonly CapBreach[] {
  const unmirroredPctNav = unmirroredWeightOf(input, navBase, (buy) =>
    isSameInstrument(buy.instrument, input.instrument)
  )
  const crossed = crossedWeights({
    heldPctNav: heldWeightOf(input.book, input.instrument) + unmirroredPctNav,
    addedPctNav,
    capPctNav: positionCapOf(input.profile.caps[input.segment], input.instrumentKind),
  })

  return crossed === undefined
    ? []
    : [{ kind: 'position', ticker: input.instrument.ticker, ...crossed }]
}

function segmentBreach(
  input: MeasuredOrder,
  addedPctNav: number,
  navBase: number
): readonly CapBreach[] {
  const { book, markets, profile, segment } = input
  const caps = profile.caps[segment]
  const unmirroredPctNav = unmirroredWeightOf(
    input,
    navBase,
    (buy) => markets.find(buy.instrument.market)?.manifest.segment === segment
  )
  const heldPctNav =
    (book.segmentValues.find((value) => value.segment === segment)?.weightPctNav ?? 0) +
    unmirroredPctNav
  // A switched-off segment holds nothing, so any buy into it crosses its zero ceiling. The sizer
  // never proposes one; only a typed order or a tool call can reach it. A segment the profile
  // records no caps for is not off, as in the draft direction, so its buys stay unmeasured here.
  const crossed =
    caps !== undefined && isSegmentDisabled(caps)
      ? { combinedPctNav: heldPctNav + addedPctNav, capPctNav: 0 }
      : crossedWeights({
          heldPctNav,
          addedPctNav,
          capPctNav: caps?.maximumSegmentPctNav ?? 0,
        })

  return crossed === undefined ? [] : [{ kind: 'segment', segment, ...crossed }]
}

/** The segment's ETF share, which only an ETF adds to. */
function etfBreach(input: MeasuredOrder, addedPctNav: number): readonly CapBreach[] {
  if (input.instrumentKind !== ETF_KIND) {
    return []
  }

  const { book, profile, segment } = input
  const caps = profile.caps[segment]

  // A switched-off segment already reports the buy once; its zero ETF cap would say it twice.
  if (caps !== undefined && isSegmentDisabled(caps)) {
    return []
  }

  return etfBreaches({
    segment,
    segmentValue: book.segmentValues.find((value) => value.segment === segment),
    addedPctNav,
    ceilingPctNav: caps?.maximumEtfPctNav,
  })
}

/** The pair every breach arm carries, or nothing where the ceiling held. One owner for the sum and
 *  the test, so the position and segment ceilings cannot come to disagree about either; each arm
 *  keeps only how it reads its own held weight and cap, which is the whole of what separates them.
 *  Named rather than positional because both are fractions of NAV and a transposition would
 *  type-check. */
function crossedWeights(input: {
  readonly heldPctNav: number
  readonly addedPctNav: number
  readonly capPctNav: number
}): { readonly combinedPctNav: number; readonly capPctNav: number } | undefined {
  const combinedPctNav = input.heldPctNav + input.addedPctNav

  return isBreached(combinedPctNav, input.capPctNav)
    ? { combinedPctNav, capPctNav: input.capPctNav }
    : undefined
}

/** The weight of NAV the unmirrored buys a ceiling counts would add, as the held weight beside it. */
function unmirroredWeightOf(
  input: OrderExposureInput,
  navBase: number,
  isCounted: (buy: UnmirroredExposure['buys'][number]) => boolean
): number {
  return (
    input.unmirrored.filter(isCounted).reduce((total, buy) => total + buy.notionalBase, 0) / navBase
  )
}

/** Positions are keyed by instrument and venue; one name held at two custodians is one position
 *  against the cap, so the weights sum. An unpriced holding carries no weight and contributes
 *  nothing — the caveat on the book already says the valuation is partial. */
function heldWeightOf(book: ValuedBook, instrument: InstrumentRef): number {
  return book.positions.reduce(
    (total, valued) =>
      valued.kind === 'priced' && isSameInstrument(valued.position.instrument, instrument)
        ? total + (valued.weightPctNav ?? 0)
        : total,
    0
  )
}

import type { ValuedBook } from '@/trading/features/portfolio/types'
import type { InstrumentKind, InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { CapBreach } from '@/trading/kernel/operator/exposure'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { OrderError } from '@/trading/features/order/types'
import { ETF_KIND, isSameInstrument } from '@/trading/kernel/instrument'
import { etfBreaches, isBreached } from '@/trading/kernel/operator/exposure'
import { isSegmentDisabled, positionCapOf } from '@/trading/kernel/operator/profile'

interface OrderExposureInput {
  readonly profile: UserProfile
  readonly book: ValuedBook
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  /** Absent where the market publishes none, which leaves the segment's ETF ceiling unmeasured
   *  rather than assuming the name is not one. */
  readonly instrumentKind?: InstrumentKind
  /** The order's value in the book's own currency, as the caps beside it are measured. */
  readonly notionalBase: number
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
export function breachedCaps(input: OrderExposureInput): readonly CapBreach[] {
  const navBase = input.book.navBase

  // No denominator, no weights. `assertBookPriced` has already refused an unpriced book, so what
  // is left is a book worth nothing, which a ratio cannot be taken against either.
  if (navBase === undefined || navBase <= 0) {
    return []
  }

  const addedPctNav = input.notionalBase / navBase

  return [
    ...positionBreach(input, addedPctNav),
    ...segmentBreach(input, addedPctNav),
    ...etfBreach(input, addedPctNav),
  ]
}

function positionBreach(input: OrderExposureInput, addedPctNav: number): readonly CapBreach[] {
  const crossed = crossedWeights({
    heldPctNav: heldWeightOf(input.book, input.instrument),
    addedPctNav,
    capPctNav: positionCapOf(input.profile.caps[input.segment], input.instrumentKind),
  })

  return crossed === undefined
    ? []
    : [{ kind: 'position', ticker: input.instrument.ticker, ...crossed }]
}

function segmentBreach(input: OrderExposureInput, addedPctNav: number): readonly CapBreach[] {
  const { book, profile, segment } = input
  const caps = profile.caps[segment]
  const heldPctNav =
    book.segmentValues.find((value) => value.segment === segment)?.weightPctNav ?? 0
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
function etfBreach(input: OrderExposureInput, addedPctNav: number): readonly CapBreach[] {
  if (input.instrumentKind !== ETF_KIND) {
    return []
  }

  const { book, profile, segment } = input

  return etfBreaches({
    segment,
    segmentValue: book.segmentValues.find((value) => value.segment === segment),
    addedPctNav,
    ceilingPctNav: profile.caps[segment]?.maximumEtfPctNav,
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

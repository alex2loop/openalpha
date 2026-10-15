import type { ValuedBook } from '@/trading/features/portfolio/types'
import type { InstrumentKind, InstrumentRef, PortfolioSegment } from '@/trading/kernel/instrument'
import type { SleeveBreach } from '@/trading/kernel/operator/exposure'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { ETF_KIND, isSameInstrument } from '@/trading/kernel/instrument'
import { isBreached } from '@/trading/kernel/operator/exposure'
import { positionCapOf } from '@/trading/kernel/operator/profile'

interface OrderExposureInput {
  readonly profile: UserProfile
  readonly book: ValuedBook
  readonly instrument: InstrumentRef
  readonly segment: PortfolioSegment
  /** Absent where the market publishes none, which leaves the sleeve's ETF ceiling unmeasured
   *  rather than assuming the name is not one. */
  readonly instrumentKind?: InstrumentKind
  /** The order's value in the book's own currency, as the caps beside it are measured. */
  readonly notionalBase: number
}

/** Where a buy would leave the ceilings this path can see without a second lookup. The sector cap
 *  is not among them: a name's sector needs a provider read the order path does not make, and a
 *  network call on the confirmation prompt is worse than a limit stated one short. It is still
 *  reported once the fill is booked, by the ledger fold `/portfolio` and `/rebalance` read. */
export function breachedSleeves(input: OrderExposureInput): readonly SleeveBreach[] {
  const navBase = input.book.navBase

  // No denominator, no weights. A book that could not be priced states nothing rather than a
  // ratio against a partial NAV, which is wrong in a way that looks authoritative.
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

function positionBreach(input: OrderExposureInput, addedPctNav: number): readonly SleeveBreach[] {
  const crossed = crossedWeights({
    heldPctNav: heldWeightOf(input.book, input.instrument),
    addedPctNav,
    capPctNav: positionCapOf(input.profile.caps[input.segment], input.instrumentKind),
  })

  return crossed === undefined
    ? []
    : [{ kind: 'position', ticker: input.instrument.ticker, ...crossed }]
}

function segmentBreach(input: OrderExposureInput, addedPctNav: number): readonly SleeveBreach[] {
  const { book, profile, segment } = input
  const crossed = crossedWeights({
    heldPctNav: book.segmentValues.find((value) => value.segment === segment)?.weightPctNav ?? 0,
    addedPctNav,
    capPctNav: profile.caps[segment]?.maximumSegmentPctNav ?? 0,
  })

  return crossed === undefined ? [] : [{ kind: 'segment', segment, ...crossed }]
}

/** The sleeve's ETF share, which only an ETF adds to. A sleeve declaring no ceiling reads as a cap
 *  of zero, which `isBreached` treats as no ceiling at all. */
function etfBreach(input: OrderExposureInput, addedPctNav: number): readonly SleeveBreach[] {
  if (input.instrumentKind !== ETF_KIND) {
    return []
  }

  const { book, profile, segment } = input
  const crossed = crossedWeights({
    heldPctNav: book.segmentValues.find((value) => value.segment === segment)?.etfPctNav ?? 0,
    addedPctNav,
    capPctNav: profile.caps[segment]?.maximumEtfPctNav ?? 0,
  })

  return crossed === undefined ? [] : [{ kind: 'etf', segment, ...crossed }]
}

/** The pair every breach arm carries, or nothing where the ceiling held. One owner for the sum and
 *  the test, so three sibling ceilings cannot come to disagree about either; each arm keeps only
 *  how it reads its own held weight and cap, which is the whole of what separates them. Named
 *  rather than positional because all three are fractions of NAV and a transposition would
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

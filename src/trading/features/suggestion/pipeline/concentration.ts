import type { ValuedPosition } from '@/trading/features/portfolio/types'
import type {
  BookExposure,
  HeldPosition,
  RoundTripHistory,
} from '@/trading/features/suggestion/exposure'
import type { SuggestionPortfolioContext } from '@/trading/features/suggestion/pipeline/types'
import type { ActionableSuggestion, ConcentrationNote } from '@/trading/features/suggestion/types'
import type {
  InstrumentKind,
  InstrumentRef,
  PortfolioSegment,
  TradingDay,
} from '@/trading/kernel/instrument'
import type { Position, PositionLot } from '@/trading/kernel/operator/book'
import { openLots, toCurrentCycles } from '@/trading/features/portfolio/folds/holdings'
import { etfHeadroomPctNav } from '@/trading/features/portfolio/folds/policy'
import { recentRoundTripsOf } from '@/trading/features/suggestion/pipeline/round-trip'
import { buildInstrumentKey, ETF_KIND, isSameInstrument } from '@/trading/kernel/instrument'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'

/** Room under the sector cap, counting what the book already holds there. A market that files this
 *  name under no sector states no exposure to weigh, so the cap cannot bind — the position and
 *  segment caps still do. */
export function sectorHeadroomPctNavOf(
  context: SuggestionPortfolioContext,
  sector: string | undefined
): number {
  if (sector === undefined) {
    return Number.POSITIVE_INFINITY
  }

  return headroomOf(context.profile.maximumSectorPctNav, heldSectorWeight(context, sector))
}

/** Room under the segment ceiling, counting what the book already holds in that segment. Fail-closed
 *  like the per-position cap: a segment with no recorded ceiling sizes to zero, since a sizer that
 *  cannot see a limit must not act as if none applies. */
export function segmentHeadroomPctNavOf(
  context: SuggestionPortfolioContext,
  segment: PortfolioSegment
): number {
  return headroomOf(
    context.profile.caps[segment]?.maximumSegmentPctNav ?? 0,
    heldSegmentWeight(context, segment)
  )
}

/** Room under the sleeve's ETF ceiling, for an ETF only. A stock is not bounded by it, and a sleeve
 *  that declares none does not bind — the position and segment caps still do. */
export function etfHeadroomPctNavOf(
  context: SuggestionPortfolioContext,
  segment: PortfolioSegment,
  instrumentKind: InstrumentKind | undefined
): number {
  if (instrumentKind !== ETF_KIND) {
    return Number.POSITIVE_INFINITY
  }

  return etfHeadroomPctNav(
    context.profile.caps[segment],
    context.book.segmentValues.find((value) => value.segment === segment)
  )
}

interface TradedWeightInput {
  /** What the book already holds of this name, absent when it holds none. */
  readonly held: HeldPosition | undefined
  readonly units: number
  /** The order's weight priced at its entry, which is what the sizer worked in. */
  readonly sizePctNav: number
}

/** The order's weight of NAV, priced the way the book prices what it already holds. Every weight it
 *  is added to or taken from is marked, and an entry-priced delta against a marked weight sums two
 *  prices — so a held name scales its own marked weight by the units traded. A name the book does
 *  not hold has no mark, and the entry it will trade at is the only price there is. */
export function tradedWeightPctNav(input: TradedWeightInput): number {
  const { held } = input

  return held === undefined || held.pctNav === undefined || held.units <= 0
    ? input.sizePctNav
    : (held.pctNav * input.units) / held.units
}

interface ConcentrationInput {
  readonly sector: string | undefined
  readonly action: ActionableSuggestion['action']
  /** Marked, from `tradedWeightPctNav`: the sector weight below is marked too. */
  readonly tradedPctNav: number
}

/** Where the order leaves the sector, against the cap it is measured by. The caveat names the
 *  ceiling that bound the size; this answers the different question of how full the sleeve now is.
 *  A reduce takes its size off the sleeve: the same note on a trim read as if it were a buy. */
export function concentrationOf(
  context: SuggestionPortfolioContext,
  input: ConcentrationInput
): ConcentrationNote | undefined {
  const { sector, tradedPctNav } = input

  if (sector === undefined) {
    return undefined
  }

  const heldPctNav = heldSectorWeight(context, sector) ?? 0

  return {
    sector,
    afterPctNav: input.action === 'reduce' ? heldPctNav - tradedPctNav : heldPctNav + tradedPctNav,
    capPctNav: context.profile.maximumSectorPctNav,
  }
}

function headroomOf(capPctNav: number, heldWeightPctNav: number | undefined): number {
  return Math.max(0, capPctNav - (heldWeightPctNav ?? 0))
}

function heldSectorWeight(context: SuggestionPortfolioContext, sector: string): number | undefined {
  return context.book.sectorValues.find((value) => value.sector === sector)?.weightPctNav
}

function heldSegmentWeight(
  context: SuggestionPortfolioContext,
  segment: PortfolioSegment
): number | undefined {
  return context.book.segmentValues.find((value) => value.segment === segment)?.weightPctNav
}

interface ExposureInput {
  readonly context: SuggestionPortfolioContext
  readonly instrument: InstrumentRef
  readonly sector?: string
  /** First session of the re-entry window, from `roundTripWindowStart`. */
  readonly since: TradingDay
}

/** Where the book already stands on this idea, as weights only. The deciding roles read this and
 *  the sizer enforces it, so both work from one reading; absolute cash stays out because a weight
 *  is what either of them can act on. */
export function exposureOf(input: ExposureInput): BookExposure {
  const { context, sector } = input
  const held = heldPositionOf(context, input.instrument)
  const roundTrips = roundTripHistoryOf(context, input.instrument, input.since)

  return {
    ...(held === undefined ? {} : { held }),
    ...(roundTrips === undefined ? {} : { roundTrips }),
    ...(sector === undefined
      ? {}
      : {
          sector: {
            name: sector,
            pctNav: heldSectorWeight(context, sector) ?? 0,
            capPctNav: context.profile.maximumSectorPctNav,
          },
        }),
  }
}

/** Absent when the operator has not closed this name inside the window: "you have never traded
 *  this" is not a fact worth a line, exactly as an unheld position is not. The return is
 *  reduced to its sign here rather than downstream, so no caller can print one. */
function roundTripHistoryOf(
  context: SuggestionPortfolioContext,
  instrument: InstrumentRef,
  since: TradingDay
): RoundTripHistory | undefined {
  const trips = recentRoundTripsOf(context.closedRoundTrips, instrument, since)
  const last = trips.at(-1)

  if (last === undefined) {
    return undefined
  }

  return {
    count: trips.length,
    lastClosedAt: last.closedAt,
    lastResult: last.realizedFraction < 0 ? 'loss' : 'gain',
  }
}

/** Absent rather than zero when the name is unheld: "you hold none" is not a fact worth a line. The
 *  weight is the one part a valuation owns - a book with an unpriced holding has no NAV to divide
 *  by - so it is attached separately rather than gating what the ledger already knows. */
export function heldPositionOf(
  context: SuggestionPortfolioContext,
  instrument: InstrumentRef
): HeldPosition | undefined {
  const held = toHeldPosition(
    toCurrentCycles(context.book.book.positions, context.minimumSizes),
    instrument
  )

  if (held === undefined || isUntradeableResidue(context, instrument, held.units)) {
    return undefined
  }

  const pctNav = totalWeightPctNav(
    context.book.positions.filter((entry) =>
      isSameInstrument(entry.position.instrument, instrument)
    )
  )

  return pctNav === undefined ? held : { ...held, pctNav }
}

/** What the book holds of one name, from its rows alone: what a levels-only plan for a booked
 *  position can know without a valuation. Summed across venues: the question is "do I own this and
 *  at what cost", a portfolio question rather than an execution one. Quantities add first, so a
 *  total of zero returns nothing rather than dividing per position. */
export function toHeldPosition(
  positions: readonly Omit<Position, 'venue'>[],
  instrument: InstrumentRef
): HeldPosition | undefined {
  const held = positions.filter((entry) => isSameInstrument(entry.instrument, instrument))
  const units = held.reduce((sum, entry) => sum + entry.quantity, 0)

  if (units <= 0) {
    return undefined
  }

  const open = openLots(held.flatMap((entry) => entry.lots))
  const firstAcquiredAt = open[0]?.acquiredAt
  const median = medianAcquiredAt(open)
  const soldUnits = held.reduce((sum, entry) => sum + entry.soldQuantity, 0)
  const settledUnits = held.reduce((sum, entry) => sum + entry.settledQuantity, 0)
  const openedOn = openedOnOf(held)
  const settlesOn =
    settledUnits < units
      ? open
          .map((lot) => lot.settledAt)
          .sort()
          .at(-1)
      : undefined

  return {
    units,
    // Quantity-weighted by construction: the basis of every venue over the units of all of them.
    unitCostNative: held.reduce((sum, entry) => sum + entry.costBasisNative, 0) / units,
    settledUnits,
    openLotCount: open.length,
    ...(firstAcquiredAt === undefined ? {} : { firstAcquiredAt }),
    ...(median === undefined ? {} : { medianAcquiredAt: median }),
    ...(settlesOn === undefined ? {} : { settlesOn }),
    ...(soldUnits > 0 ? { soldUnits } : {}),
    ...(openedOn === undefined ? {} : { openedOn }),
  }
}

/** The day the holding as it stands opened: its oldest buy on any venue. */
function openedOnOf(held: readonly Omit<Position, 'venue'>[]): TradingDay | undefined {
  return held
    .flatMap((entry) => entry.buys.map((buy) => buy.acquiredAt))
    .reduce<TradingDay | undefined>(
      (earliest, day) => (earliest === undefined || day < earliest ? day : earliest),
      undefined
    )
}

/** The day by which half of what is still held had been bought: open lots, oldest first,
 *  weighted by what each still holds. A recent add moves it by the share it bought, where the first
 *  lot's day ignores it and a mean lands between sessions. */
function medianAcquiredAt(open: readonly PositionLot[]): TradingDay | undefined {
  const total = open.reduce((sum, lot) => sum + lot.remainingQuantity, 0)
  let held = 0

  for (const lot of open) {
    held += lot.remainingQuantity

    if (held * 2 >= total) {
      return lot.acquiredAt
    }
  }

  return undefined
}

/** Residue a full exit left behind is not a position to plan around, and its denominator distorts
 *  the traded weight the sector note is measured on. */
function isUntradeableResidue(
  context: SuggestionPortfolioContext,
  instrument: InstrumentRef,
  units: number
): boolean {
  return isBelowMinimumSize(units, context.minimumSizes.get(buildInstrumentKey(instrument)))
}

/** Summed for the same reason the quantities are: one name at two custodians is one exposure, and
 *  a first-row weight understates it wherever the sizing headroom is measured against it. Absent
 *  when any leg is unpriced, because the book then has no NAV to be a share of. */
function totalWeightPctNav(valued: readonly ValuedPosition[]): number | undefined {
  if (valued.length === 0) {
    return undefined
  }

  let total = 0

  for (const entry of valued) {
    if (entry.kind !== 'priced' || entry.weightPctNav === undefined) {
      return undefined
    }

    total += entry.weightPctNav
  }

  return total
}

import type { Holding, ValuedBook, ValuedPosition } from '@/trading/features/portfolio/types'
import type {
  Book,
  ClosedRoundTrip,
  Position,
  PositionLot,
  SaleRecord,
} from '@/trading/kernel/operator/book'
import { ValidationError } from '@/core/errors'
import { QUANTITY_EPSILON } from '@/trading/features/ledger/position'
import { buildInstrumentKey, buildPositionKey } from '@/trading/kernel/instrument'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'

/** How many closed round trips a surface lists: the recent ones an operator still asks about, so a
 *  long ledger cannot grow the message. */
const LISTED_ROUND_TRIPS = 10
const RESIDUE_AT_COST = 'valuation.residue-at-cost'

interface OpenCycle {
  proceedsNative: number
  basisReleasedNative: number
  realizedBase: number
}

/** The parcels a holding is still made of, oldest first: what sales left behind, in the order they
 *  were acquired. Two readers ask different questions of this - how many buys built the position,
 *  and when the first of them was - so the filter lives here rather than at each of them. */
export function openLots(lots: readonly PositionLot[]): readonly PositionLot[] {
  return lots
    .filter((lot) => lot.remainingQuantity > 0)
    .sort((left, right) => left.acquiredAt.localeCompare(right.acquiredAt))
}

/** One holding per instrument, in first-seen order. The same coin at two custodians is two
 *  positions in the ledger and one exposure to the book — priced once, weighed once, and named as
 *  a split only where it spans more than one. */
export function toHoldings(positions: readonly Position[]): readonly Holding[] {
  const groups = new Map<string, Position[]>()

  for (const position of positions) {
    const key = buildInstrumentKey(position.instrument)
    const group = groups.get(key)

    if (group === undefined) {
      groups.set(key, [position])
    } else {
      group.push(position)
    }
  }

  return [...groups.values()].map(mergeHolding)
}

/** The holdings the operator can still act on. Merged before it is filtered, because a name split
 *  across custodians is one exposure and the floor it is measured against is the tightest any of
 *  them publishes — the same reading `/suggest` takes of the same book. */
export function toTradeableHoldings(
  positions: readonly Position[],
  minimumSizes: ReadonlyMap<string, number>
): readonly Holding[] {
  return toHoldings(toCurrentCycles(positions, minimumSizes)).filter(
    (holding) =>
      !isBelowMinimumSize(
        holding.quantity,
        minimumSizes.get(buildInstrumentKey(holding.instrument))
      )
  )
}

/** Each position from the buy that opened the holding as it stands: the latest one that landed on
 *  nothing, or on a sliver below the venue's smallest order. A full exit usually leaves such a
 *  sliver, and the fold never calls it flat, so without this a new holding inherits the sales and
 *  the opening day of the one before it. */
export function toCurrentCycles(
  positions: readonly Position[],
  minimumSizes: ReadonlyMap<string, number>
): readonly Position[] {
  return positions.map((position) =>
    toCurrentCycle(position, minimumSizes.get(buildInstrumentKey(position.instrument)))
  )
}

function toCurrentCycle(position: Position, minimumSize: number | undefined): Position {
  const index = position.buys.findLastIndex(
    (buy) => buy.heldBefore <= QUANTITY_EPSILON || isBelowMinimumSize(buy.heldBefore, minimumSize)
  )
  const opening = position.buys[index]

  return index <= 0 || opening === undefined
    ? position
    : {
        ...position,
        soldQuantity: position.soldQuantity - opening.soldBefore,
        buys: position.buys.slice(index),
      }
}

/** The round trips the sales closed, oldest first: a sale that left nothing, or a sliver below the
 *  venue's smallest order, ends one - the same line `toCurrentCycles` opens the next at. A cycle
 *  that released no basis has no return to state: a parcel received at zero cost. */
export function closedRoundTripsOf(
  sales: readonly SaleRecord[],
  minimumSizes: ReadonlyMap<string, number>
): readonly ClosedRoundTrip[] {
  const open = new Map<string, OpenCycle>()
  const trips: ClosedRoundTrip[] = []

  for (const sale of sales) {
    const key = buildPositionKey(sale.instrument, sale.venue)
    const cycle = addSale(open.get(key), sale)
    const minimumSize = minimumSizes.get(buildInstrumentKey(sale.instrument))

    if (
      sale.remainingQuantity > QUANTITY_EPSILON &&
      !isBelowMinimumSize(sale.remainingQuantity, minimumSize)
    ) {
      open.set(key, cycle)
      continue
    }

    open.delete(key)

    if (cycle.basisReleasedNative > 0) {
      trips.push(toRoundTrip(sale, cycle))
    }
  }

  return trips
}

/** The most recent closed round trips, newest first. A surface with less room names its own count. */
export function recentClosedRoundTrips(
  trips: readonly ClosedRoundTrip[],
  limit: number = LISTED_ROUND_TRIPS
): readonly ClosedRoundTrip[] {
  return trips
    .toSorted((left, right) => right.closedAt.localeCompare(left.closedAt))
    .slice(0, limit)
}

function addSale(cycle: OpenCycle | undefined, sale: SaleRecord): OpenCycle {
  return {
    proceedsNative: (cycle?.proceedsNative ?? 0) + sale.proceedsNative,
    basisReleasedNative: (cycle?.basisReleasedNative ?? 0) + sale.basisReleasedNative,
    realizedBase: (cycle?.realizedBase ?? 0) + sale.realizedBase,
  }
}

function toRoundTrip(sale: SaleRecord, cycle: OpenCycle): ClosedRoundTrip {
  return {
    instrument: sale.instrument,
    venue: sale.venue,
    closedAt: sale.at,
    exitPriceNative: sale.unitPriceNative,
    realizedFraction: cycle.proceedsNative / cycle.basisReleasedNative - 1,
    realizedBase: cycle.realizedBase,
  }
}

function mergeHolding(group: readonly Position[]): Holding {
  const [first, ...rest] = group

  if (first === undefined) {
    throw new ValidationError('a holding group cannot be empty')
  }

  // The custodian is dropped either way: a merged holding belongs to no single one, and carrying
  // the first venue's id would read as though it did.
  const { venue: _venue, ...merged } = rest.length === 0 ? first : group.reduce(addHolding)

  return rest.length === 0
    ? merged
    : {
        ...merged,
        venueSplit: group.map((position) => ({
          venue: position.venue,
          units: position.quantity,
        })),
      }
}

function addHolding(left: Position, right: Position): Position {
  return {
    ...left,
    quantity: left.quantity + right.quantity,
    settledQuantity: left.settledQuantity + right.settledQuantity,
    costBasisNative: left.costBasisNative + right.costBasisNative,
    costBasisBase: left.costBasisBase + right.costBasisBase,
    costBasisFeesNative: left.costBasisFeesNative + right.costBasisFeesNative,
    costBasisFeesBase: left.costBasisFeesBase + right.costBasisFeesBase,
    soldQuantity: left.soldQuantity + right.soldQuantity,
    buys: [...left.buys, ...right.buys],
    lots: [...left.lots, ...right.lots],
  }
}

/** Residue below the venue's smallest order is no holding: nothing sizes it, lists it or counts it.
 *  Its value stays in NAV. */
export function withoutResidue(
  valued: ValuedBook,
  minimumSizes: ReadonlyMap<string, number>
): ValuedBook {
  const positions = valued.positions.filter(
    (entry) =>
      !isBelowMinimumSize(
        entry.position.quantity,
        minimumSizes.get(buildInstrumentKey(entry.position.instrument))
      )
  )

  return { ...valued, positions }
}

/** What counting unpriced residue at cost reads: the venue positions behind each holding and how
 *  each venue's smallest order is found, keyed by `buildInstrumentKey`. */
export interface ResidueSizing {
  readonly book: Book
  minimumSizes?(
    positions: readonly Position[],
    signal: AbortSignal
  ): Promise<ReadonlyMap<string, number>>
  readonly signal: AbortSignal
}

/** A sliver below the venue's smallest order that no source prices any more (a delisted coin) would
 *  otherwise withhold NAV, and with it every buy's caps, for a value that rounds away. It counts at
 *  what it cost and says so; a real position with no price still withholds NAV. */
export async function withResidueAtCost(
  outcomes: readonly { readonly valued: ValuedPosition }[],
  options: ResidueSizing
): Promise<readonly ValuedPosition[]> {
  const valued = outcomes.map((outcome) => outcome.valued)
  const unpriced = new Set(
    valued.flatMap((entry) =>
      entry.kind === 'unpriced' ? [buildInstrumentKey(entry.position.instrument)] : []
    )
  )

  if (options.minimumSizes === undefined || unpriced.size === 0) {
    return valued
  }

  const sizes = await options.minimumSizes(
    options.book.positions.filter((position) =>
      unpriced.has(buildInstrumentKey(position.instrument))
    ),
    options.signal
  )

  return valued.map((entry) =>
    entry.kind === 'unpriced' &&
    isBelowMinimumSize(
      entry.position.quantity,
      sizes.get(buildInstrumentKey(entry.position.instrument))
    )
      ? {
          ...entry,
          caveat: {
            code: RESIDUE_AT_COST,
            detail: { ticker: entry.position.instrument.ticker },
          },
        }
      : entry
  )
}

/** What the holdings are worth in base currency, residue at cost included; nothing while any
 *  holding has no value NAV could sum. */
export function countedValueOf(valued: readonly ValuedPosition[]): number | undefined {
  return valued.every((entry) => entry.kind === 'priced' || isAtCost(entry))
    ? valued.reduce((sum, entry) => sum + valueOrCostOf(entry), 0)
    : undefined
}

function isAtCost(entry: ValuedPosition): boolean {
  return entry.kind === 'unpriced' && entry.caveat.code === RESIDUE_AT_COST
}

function valueOrCostOf(entry: ValuedPosition): number {
  if (entry.kind === 'priced') {
    return entry.valueBase
  }

  return isAtCost(entry) ? entry.position.costBasisBase : 0
}

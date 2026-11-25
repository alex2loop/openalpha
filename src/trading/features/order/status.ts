import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { ExitCoverage, UnguardedPosition } from '@/trading/features/order/exit-coverage'
import type {
  RestingExit,
  RestingExitRow,
  StagedOrder,
  TradeStatus,
} from '@/trading/features/order/types'
import type { VenueRef } from '@/trading/kernel/instrument'
import type { StopCover } from '@/trading/kernel/operator/alert'
import type { Position } from '@/trading/kernel/operator/book'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { CONFIRM_TTL_MS } from '@/trading/features/order/intents'
import {
  exitsByPosition,
  guardedQuantityOf,
  liveExits,
  restingOn,
} from '@/trading/features/order/resting'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { isBelowMinimumSize } from '@/trading/kernel/venue/catalog'
import { minimumSizesByInstrument } from '@/trading/venues/holdings'

/** What one screen carries per section. The surface is read to decide what to do next, not to
 *  inventory a desk, so every section states the first rows rather than all of them. */
const STATUS_ROWS = 10
/** How much of a position may sit outside its exit before the book says so, as a fraction of the
 *  position. A whole-position exit is floored to the venue's lot, so every guarded position carries
 *  a residue no order could ever cover, and reporting that would flag the entire book forever.
 *  Anything an operator deliberately left out is orders of magnitude above this. */
const UNGUARDED_FRACTION = 0.01
const NO_STOPS: ReadonlyMap<string, number> = new Map()
/** The weakest cover on any venue holding a name is the name's cover. */
const COVER_STRENGTH: Readonly<Record<StopCover, number>> = Object.freeze({
  none: 0,
  venue: 1,
  placed: 2,
})

interface TradeStatusInput {
  readonly now: number
  readonly signal: AbortSignal
}

/** The four things this tree is holding on the operator's behalf, read together because they answer
 *  one question. Nothing here reaches a venue: a status that needs every exchange up goes blank
 *  exactly when the operator most needs to know what is outstanding. */
export async function resolveTradeStatus(
  deps: OrderServiceDeps,
  input: TradeStatusInput
): Promise<TradeStatus> {
  const [staged, exits, unmirrored, positions, haltedAt] = await Promise.all([
    deps.intents.listStaged({
      notBefore: input.now - CONFIRM_TTL_MS,
      limit: STATUS_ROWS,
      signal: input.signal,
    }),
    liveExits(deps, input.signal),
    deps.intents.listUnmirrored(input.signal),
    deps.portfolio.positionsAt({ now: input.now, signal: input.signal }),
    deps.settings.haltedAt(input.signal),
  ])

  return {
    staged,
    exits: exits.slice(0, STATUS_ROWS).map((exit) => withCurrency(deps, exit)),
    unmirrored: unmirrored.slice(0, STATUS_ROWS),
    ...unguardedStatus(deps, {
      positions: await tradeablePositions(deps, positions, input.signal),
      exits,
      venueStops: await stopsAtVenues(deps, placeablePositions(deps, positions), input.signal),
    }),
    ...(haltedAt === undefined ? {} : { haltedAt }),
  }
}

/** The floor the rest of the surface already reads: a holding under the venue's smallest order is
 *  residue a full exit left behind, and listing it as unprotected states an exposure no order could
 *  ever cover. `isBelowMinimumSize` answers `false` for a floor nobody published, so an unreachable
 *  catalog leaves the row visible - the error to avoid is hiding a real holding with no stop. */
async function tradeablePositions(
  deps: OrderServiceDeps,
  positions: readonly Position[],
  signal: AbortSignal
): Promise<TradeablePositions> {
  const floors = await minimumSizesByInstrument(deps.venues, positions, signal)
  const tradeable = positions.filter(
    (position) =>
      !isBelowMinimumSize(position.quantity, floors.get(buildInstrumentKey(position.instrument)))
  )

  return {
    tradeable,
    residue: positions
      .filter((position) => !tradeable.includes(position))
      .map((position) => position.instrument.ticker),
  }
}

/** What the section shows, and what it held back: a row dropped in silence reads as a book with
 *  fewer positions than it has. */
interface TradeablePositions {
  readonly tradeable: readonly Position[]
  readonly residue: readonly string[]
}

type VenueStops = ReadonlyMap<VenueRef, ReadonlyMap<string, number>>

interface GuardInput {
  readonly positions: TradeablePositions
  readonly exits: readonly RestingExit[]
  readonly venueStops: VenueStops
}

/** A venue whose stops could not be read is not named unguarded on a guess. */
function unguardedStatus(
  deps: OrderServiceDeps,
  input: GuardInput
): Pick<TradeStatus, 'unguarded' | 'unguardedResidue'> {
  const { tradeable, residue } = input.positions
  const readable = tradeable.filter((position) => input.venueStops.has(position.venue))

  return {
    unguarded: unguardedPositions(deps, readable, input).slice(0, STATUS_ROWS),
    unguardedResidue: residue,
  }
}

/** The size a stop the operator set in the exchange's app covers, as far as this screen can tell;
 *  undefined when the venue lists no stop on the position. */
function stopSizeAtVenue(
  deps: OrderServiceDeps,
  position: Position,
  venueStops: VenueStops
): number | undefined {
  const symbol = deps.venues.find(position.venue)?.adapter?.toSymbol(position.instrument)

  return symbol === undefined ? undefined : venueStops.get(position.venue)?.get(symbol)
}

function withCurrency(deps: OrderServiceDeps, exit: RestingExit): RestingExitRow {
  const currency = deps.markets.find(exit.instrument.market)?.manifest.currency

  return { ...exit, ...(currency === undefined ? {} : { currency }) }
}

/** Positions with less stop standing at them than the book says is held, largest gap first. Only
 *  where the venue carries an adapter: a custodian this tree has no client for can hold no resting
 *  order at all, so naming its positions unguarded would flag every hand-held book forever. What
 *  stands is the larger of this tree's stops and the stops the venue lists, since the venue's list
 *  holds this tree's own stops as well. A take-profit alone guards nothing. */
function unguardedPositions(
  deps: OrderServiceDeps,
  positions: readonly Position[],
  input: Pick<GuardInput, 'exits' | 'venueStops'>
): readonly UnguardedPosition[] {
  const resting = exitsByPosition(input.exits)

  return placeablePositions(deps, positions)
    .map((position) => {
      const exits = restingOn(resting, position)
      const stops = stopsOf(exits)

      return {
        instrument: position.instrument,
        venue: position.venue,
        quantity: position.quantity,
        guarded: Math.max(
          guardedQuantityOf(stops),
          stopSizeAtVenue(deps, position, input.venueStops) ?? 0
        ),
        ...(stops.length === 0 && exits.length > 0 ? { takeProfitOnly: true as const } : {}),
      }
    })
    .filter((row) => gapOf(row) > row.quantity * UNGUARDED_FRACTION)
    .sort((left, right) => gapOf(right) - gapOf(left))
}

function gapOf(row: UnguardedPosition): number {
  return row.quantity - row.guarded
}

/** How much of each position has a stop standing at it, for the agent that has to know whether a
 *  holding is protected before it advises anything that assumes a stop. A fraction and never a
 *  quantity: unit counts are book size, which an agent may not see. */
export async function resolveExitCoverage(
  deps: OrderServiceDeps,
  input: TradeStatusInput
): Promise<readonly ExitCoverage[]> {
  const [exits, positions] = await Promise.all([
    liveExits(deps, input.signal),
    deps.portfolio.positionsAt({ now: input.now, signal: input.signal }),
  ])
  const resting = exitsByPosition(exits)
  const { tradeable } = await tradeablePositions(deps, positions, input.signal)

  return placeablePositions(deps, tradeable).map((position) =>
    toCoverage(position, restingOn(resting, position))
  )
}

/** Levels only where exactly one exit rests: two would be one operator's pair and another's, and
 *  naming either would report a stop the rest of the position does not have. */
function toCoverage(position: Position, resting: readonly RestingExit[]): ExitCoverage {
  const [only, second] = resting
  const levels = second === undefined ? only : undefined

  return {
    instrument: position.instrument,
    venue: position.venue,
    guardedShare: coveredFractionOf(guardedQuantityOf(stopsOf(resting)), position.quantity),
    ...(levels?.takeProfit === undefined ? {} : { takeProfit: levels.takeProfit }),
    ...(levels?.stopLoss === undefined ? {} : { stopLoss: levels.stopLoss }),
  }
}

/** Which instruments this tree could place a stop for, and who stands behind each one. Keyed by
 *  instrument because that is how a book row is keyed; an instrument held only at custodians with
 *  no client is absent, because nothing can rest there and a row that called it unplaced would flag
 *  every hand-held holding forever. A venue whose stops could not be read is absent too: claiming
 *  none there would tell an operator with a stop in the exchange's app to place a second one. So is
 *  a name split across venues when any one of them could not be read: the rest would speak for a
 *  parcel they do not hold. */
export async function resolveRestingStops(
  deps: OrderServiceDeps,
  input: TradeStatusInput
): Promise<ReadonlyMap<string, StopCover>> {
  const [exits, positions] = await Promise.all([
    liveExits(deps, input.signal),
    deps.portfolio.positionsAt({ now: input.now, signal: input.signal }),
  ])
  const placeable = placeablePositions(deps, positions)
  const venueStops = await stopsAtVenues(deps, placeable, input.signal)
  const resting = exitsByPosition(exits)
  const unreadable = new Set(
    placeable
      .filter((position) => !venueStops.has(position.venue))
      .map((position) => buildInstrumentKey(position.instrument))
  )
  const covers = new Map<string, StopCover>()

  // Every venue holding the name has to be covered: one custodian's stop does not protect the
  // parcel sitting at another.
  for (const position of placeable) {
    const key = buildInstrumentKey(position.instrument)

    if (unreadable.has(key)) {
      continue
    }

    const stops = stopsOf(restingOn(resting, position))
    const venueSize = stopSizeAtVenue(deps, position, venueStops) ?? 0
    const cover = coverOf(
      { placed: guardedQuantityOf(stops), atVenue: venueSize },
      position.quantity
    )

    covers.set(key, weakerCover(covers.get(key), cover))
  }

  return covers
}

/** `placed` is what this tree's stops guard, `atVenue` what the venue lists; a stop that guards
 *  only part of the position is not cover for the rest. */
function coverOf(
  guarded: { readonly placed: number; readonly atVenue: number },
  held: number
): StopCover {
  if (coveredFractionOf(guarded.placed, held) === 1) {
    return 'placed'
  }

  return coveredFractionOf(guarded.atVenue, held) === 1 ? 'venue' : 'none'
}

function weakerCover(held: StopCover | undefined, next: StopCover): StopCover {
  return held === undefined || COVER_STRENGTH[next] < COVER_STRENGTH[held] ? next : held
}

/** The size each venue holds live sell stops on, per symbol. A venue with no way to list them
 *  answers with none, which is what it answered before; one whose read failed is left out, so its
 *  names claim nothing. */
async function stopsAtVenues(
  deps: OrderServiceDeps,
  positions: readonly Position[],
  signal: AbortSignal
): Promise<VenueStops> {
  const venues = [...new Set(positions.map((position) => position.venue))]
  const read = await Promise.all(
    venues.map(async (venue) => [venue, await stopsAt(deps, venue, signal)] as const)
  )

  return new Map(read.flatMap(([venue, stops]) => (stops === undefined ? [] : [[venue, stops]])))
}

async function stopsAt(
  deps: OrderServiceDeps,
  venue: VenueRef,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number> | undefined> {
  const adapter = deps.venues.find(venue)?.adapter

  if (adapter?.listStopSizes === undefined) {
    return NO_STOPS
  }

  try {
    return await adapter.listStopSizes(signal)
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    deps.logger.warn('trading.venue_stops_unread', { venue, err: formatErrForLog(err) })

    return undefined
  }
}

/** Snapped to 1 inside the same tolerance the book uses to call a position guarded: a whole-position
 *  exit is floored to the venue's lot, and the operator's surface and the agent's must not disagree
 *  about whether a stop covers a holding. */
function coveredFractionOf(guarded: number, held: number): number {
  const covered = Math.min(guarded / held, 1)

  return covered >= 1 - UNGUARDED_FRACTION ? 1 : covered
}

/** Positions at a venue this tree can place on. Nothing rests at a custodian it has no client for,
 *  so a hand-held holding is absent rather than reported as unprotected. */
function placeablePositions(
  deps: OrderServiceDeps,
  positions: readonly Position[]
): readonly Position[] {
  return positions.filter((position) => deps.venues.find(position.venue)?.adapter !== undefined)
}

/** Only the exits carrying a stop-loss: a take-profit alone leaves the position unprotected. */
function stopsOf(exits: readonly RestingExit[]): readonly RestingExit[] {
  return exits.filter((exit) => exit.stopLoss !== undefined)
}

/** The one staged order a bare confirm may claim. `undefined` where none or several are quotable,
 *  which the surface reports differently: nothing to confirm is not a choice to make. */
export function soleStagedOrder(staged: readonly StagedOrder[]): StagedOrder | undefined {
  const [only, second] = staged

  return second === undefined ? only : undefined
}

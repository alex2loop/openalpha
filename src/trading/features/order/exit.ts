import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type {
  CancelExitRequest,
  ExitLevels,
  ExitOutcome,
  ExitReceipt,
  RestingExit,
  SetExitRequest,
} from '@/trading/features/order/types'
import type { CurrencyCode, InstrumentRef, VenueRef } from '@/trading/kernel/instrument'
import type { Position } from '@/trading/kernel/operator/book'
import type { VenueRegistry } from '@/trading/venues/types'
import { formatErrForLog } from '@/core/security/credentials'
import { resolveInstrument } from '@/trading/features/market-data/resolve'
import { recoverPlacedExit } from '@/trading/features/order/exit-recovery'
import { settleSignal } from '@/trading/features/order/mirror'
import { isExitInverted } from '@/trading/features/order/policy'
import { roundExitLevels, roundToInstrument } from '@/trading/features/order/precision'
import { adapterFor, buildVenueList, resolveOrderVenue } from '@/trading/features/order/routing'
import { OrderError, OrderQuantityError } from '@/trading/features/order/types'
import { isSameInstrument } from '@/trading/kernel/instrument'

interface PlaceExitRequest {
  readonly instrument: InstrumentRef
  readonly symbol: string
  readonly venue: RoutedVenue
  readonly exit: ExitLevels
  /** The price the levels are judged against: the fill's average on an entry, the live quote on a
   *  position already held. */
  readonly reference: number
  readonly quantity: number
  /** Seeds the exchange's client id, so a retry of the same operator request re-derives the same
   *  one and a new request never does. */
  readonly key: string
  readonly now: number
  readonly signal: AbortSignal
}

/** The exit that went out, and the size and levels it went out with — the rounded ones, never what
 *  the caller asked for, so a surface reports what actually rests at the venue. */
interface PlacedExit {
  readonly receipt: ExitReceipt
  readonly quantity: number
  readonly exit: ExitLevels
}

/** Refuses before anything is placed on a venue that rests no bracket order: the position stays
 *  guarded by alerts alone. */
export function assertRestsExits(venues: VenueRegistry, venue: VenueRef): void {
  if (venues.find(venue)?.manifest.execution?.exit === 'none') {
    throw new OrderError('order.exit_unsupported', venue)
  }
}

/** Three things decide an exit and two are easy to get wrong. The size is the *booked* quantity,
 *  never `accFillSz` — a buy whose fee came out in base received fewer coins, and an exit sized on
 *  the fill tries to sell some it never got; re-rounding is required because netting a fee off a
 *  valid lot rarely leaves one. Direction is re-checked against the fill, not the request: a market
 *  entry can fill past a tight take-profit, and an exit on that position triggers immediately. */
export async function placeExit(
  deps: OrderServiceDeps,
  input: PlaceExitRequest
): Promise<PlacedExit> {
  assertRestsExits(deps.venues, input.venue.id)

  if (isExitInverted({ reference: input.reference, ...input.exit })) {
    throw new OrderError('order.exit_inverted', 'the fill landed outside the exit')
  }

  const { adapter } = input.venue
  const place = adapter.placeExit

  if (place === undefined) {
    throw new OrderError('order.exit_unsupported', input.venue.id)
  }

  const limits = await adapter.fetchLimits(input.symbol, input.signal)
  const rounded = roundToInstrument({ limits, quantity: input.quantity })
  const exit = roundExitLevels(limits, input.exit)
  const exitClientId = adapter.toClientOrderId(`${input.key}:exit`)
  const receipt = await place({
    symbol: input.symbol,
    size: rounded.quantity,
    exitClientId,
    signal: input.signal,
    ...exit,
  }).catch((err: unknown) =>
    recoverPlacedExit(deps, { venue: input.venue, symbol: input.symbol, exitClientId }, err)
  )

  // Under a bound of its own, never the caller's: that signal is often the abort that interrupted
  // the call, and a refused row would leave the exit live at the exchange with nothing here able to
  // address it.
  try {
    await deps.resting.insert(
      {
        exitClientId,
        exitId: receipt.exitId,
        symbol: input.symbol,
        venue: input.venue.id,
        instrument: input.instrument,
        quantity: rounded.quantity,
        placedAt: input.now,
        ...exit,
      },
      settleSignal()
    )
  } catch (err: unknown) {
    // The exit is live at the exchange and nothing here can address it again: the tick reconciles
    // from these rows alone. Taking it back down is the only way the operator's "no exit attached"
    // stays true, and a cancel that itself fails is reported rather than retried.
    await withdrawExit(deps, { receipt, symbol: input.symbol, venue: input.venue })

    throw err
  }

  return { receipt, quantity: rounded.quantity, exit }
}

interface WithdrawInput {
  readonly receipt: ExitReceipt
  readonly symbol: string
  readonly venue: RoutedVenue
}

async function withdrawExit(deps: OrderServiceDeps, input: WithdrawInput): Promise<void> {
  const cancelExit = input.venue.adapter.cancelExit

  if (cancelExit === undefined) {
    deps.logger.error('order.exit_orphaned', {
      exitClientId: input.receipt.exitClientId,
      exitId: input.receipt.exitId,
      symbol: input.symbol,
      venue: input.venue.id,
    })

    return
  }

  try {
    await cancelExit({
      symbol: input.symbol,
      exitId: input.receipt.exitId,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.exit_orphaned', {
      exitClientId: input.receipt.exitClientId,
      exitId: input.receipt.exitId,
      symbol: input.symbol,
      venue: input.venue.id,
      err: formatErrForLog(err),
    })
  }
}

/** Resolves the instrument's resting exits and removes them deliberately. `false` when there were
 *  none, so the surface renders its own arm rather than reporting a cancel that did not happen. */
export async function cancelRestingExit(
  deps: OrderServiceDeps,
  input: CancelExitRequest
): Promise<boolean> {
  const resolution = await resolveInstrument(deps.markets, {
    ticker: input.ticker,
    signal: input.signal,
  })

  if (resolution.kind === 'unresolved') {
    throw new OrderError('order.rejected', `no market quotes ${input.ticker}`)
  }

  const live = await deps.resting.liveExits(resolution.instrument, input.signal)
  const resting = resolveRestingExits(live, input.venue)
  const first = resting[0]

  if (first === undefined) {
    return false
  }

  assertRestsExits(deps.venues, first.venue)

  const { adapter } = adapterFor(deps.venues, first.venue)
  const cancelExit = adapter.cancelExit

  if (cancelExit === undefined) {
    throw new OrderError('order.exit_unsupported', first.venue)
  }

  // Every cancel before any mark: interleaving them would let a second cancel throw with the first
  // already recorded closed, leaving a live exit behind a message saying it is gone. Marking after
  // fails the other way — a cancelled exit still reads live, which the next cancel settles.
  for (const exit of resting) {
    await cancelExit({
      symbol: exit.symbol,
      exitId: exit.exitId,
      signal: input.signal,
    })
  }

  for (const exit of resting) {
    await deps.resting.markClosed(exit.exitClientId, settleSignal())
  }

  return true
}

/** Sets or moves the exit on a position the book already holds. Three arms and no fourth: nothing
 *  resting is placed, a matching pair is amended in place, and anything else is refused. There is
 *  deliberately no cancel-then-place, because that is the only shape whose second failure leaves a
 *  position with no protection at all. One exit per venue whatever size it covers — a second would
 *  have no name the operator could amend it by, and every guard here reads the single row. */
export async function setRestingExit(
  deps: OrderServiceDeps,
  input: SetExitRequest
): Promise<ExitOutcome> {
  const resolution = await resolveInstrument(deps.markets, {
    ticker: input.ticker,
    signal: input.signal,
  })

  if (resolution.kind === 'unresolved') {
    throw new OrderError('order.rejected', `no market quotes ${input.ticker}`)
  }

  const { instrument } = resolution
  const positions = await deps.portfolio.positionsAt({ now: input.now, signal: input.signal })
  const held = heldQuantitiesOf(positions, instrument)

  if (held.size === 0) {
    throw new OrderError('order.no_position', `the book holds no ${input.ticker}`)
  }

  const venue = await resolveOrderVenue({
    market: instrument.market,
    side: 'sell',
    venues: deps.venues,
    holdingVenues: () => Promise.resolve([...held.keys()]),
    ...(input.venue === undefined ? {} : { named: input.venue }),
  })

  assertRestsExits(deps.venues, venue.id)

  const reference = await deps.quoteOf(instrument, input.now, input.signal)

  if (isExitInverted({ reference, ...input.exit })) {
    throw new OrderError('order.exit_inverted', 'those levels would fire straight away')
  }

  // Total: routing narrowed a sell to the venues this map was built from.
  const heldHere = held.get(venue.id) ?? 0

  return await applyExit(deps, {
    instrument,
    currency: resolution.market.manifest.currency,
    venue,
    reference,
    held: heldHere,
    quantity: resolveCoverage(input, heldHere),
    exit: input.exit,
    requestId: input.requestId,
    now: input.now,
    signal: input.signal,
  })
}

/** How much of the position the exit will cover. A size above what this venue holds is refused
 *  rather than trimmed: a venue that freezes nothing behind a resting trigger accepts one sized
 *  past the balance now and quietly under-fills it at the moment it fires. */
function resolveCoverage(input: SetExitRequest, held: number): number {
  const quantity = input.quantity ?? held

  if (!(quantity > 0) || quantity > held) {
    throw new OrderQuantityError('order.exit_oversized', input.ticker, held)
  }

  return quantity
}

/** What each venue holds of one instrument, empty entries dropped so the map doubles as the routing
 *  candidate list. */
function heldQuantitiesOf(
  positions: readonly Position[],
  instrument: InstrumentRef
): ReadonlyMap<VenueRef, number> {
  const held = new Map<VenueRef, number>()

  for (const position of positions) {
    if (isSameInstrument(position.instrument, instrument) && position.quantity > 0) {
      held.set(position.venue, position.quantity)
    }
  }

  return held
}

interface ApplyExitInput {
  readonly instrument: InstrumentRef
  readonly currency: CurrencyCode
  readonly venue: RoutedVenue
  readonly reference: number
  /** What the venue holds, which the covered size is reported against. */
  readonly held: number
  readonly quantity: number
  readonly exit: ExitLevels
  readonly requestId: string
  readonly now: number
  readonly signal: AbortSignal
}

async function applyExit(deps: OrderServiceDeps, input: ApplyExitInput): Promise<ExitOutcome> {
  const live = await deps.resting.liveExits(input.instrument, input.signal)
  const resting = live.filter((entry) => entry.venue === input.venue.id)
  const [first] = resting

  if (first === undefined) {
    return await placeFresh(deps, input)
  }

  // Two resting exits cannot be amended into one, and a leg shape is fixed at placement. Both are
  // the operator's call to make with `/trade cancel`, never this path's to make for them.
  if (resting.length > 1 || !hasSameLegs(first, input.exit)) {
    throw new OrderError(
      'order.exit_conflict',
      `${input.instrument.ticker} already rests an exit at ${input.venue.id}`
    )
  }

  return await amendResting(deps, input, first)
}

function hasSameLegs(resting: RestingExit, exit: ExitLevels): boolean {
  return (
    (resting.takeProfit === undefined) === (exit.takeProfit === undefined) &&
    (resting.stopLoss === undefined) === (exit.stopLoss === undefined)
  )
}

async function placeFresh(deps: OrderServiceDeps, input: ApplyExitInput): Promise<ExitOutcome> {
  const placed = await placeExit(deps, {
    instrument: input.instrument,
    symbol: input.venue.adapter.toSymbol(input.instrument),
    venue: input.venue,
    exit: input.exit,
    reference: input.reference,
    quantity: input.quantity,
    key: input.requestId,
    now: input.now,
    signal: input.signal,
  })

  return {
    action: 'placed',
    venue: input.venue.id,
    instrument: input.instrument,
    currency: input.currency,
    quantity: placed.quantity,
    uncovered: uncoveredOf(input),
    ...placed.exit,
  }
}

/** Measured against the size that was asked for, never the rounded one that went out. Rounding
 *  floors to the venue's lot, so a whole-position exit always leaves a residue below it — reported
 *  as uncovered, every exit would claim to leave something behind that no order could ever
 *  cover. */
function uncoveredOf(input: ApplyExitInput): number {
  return Math.max(input.held - input.quantity, 0)
}

/** The venue moves first and the row follows. A row that fails to catch up is logged and the
 *  amendment still reported: the exchange holds the new levels either way, and telling the operator
 *  their stop did not move when it did is the worse of the two wrong answers. */
async function amendResting(
  deps: OrderServiceDeps,
  input: ApplyExitInput,
  resting: RestingExit
): Promise<ExitOutcome> {
  const amendExit = input.venue.adapter.amendExit

  if (amendExit === undefined) {
    throw new OrderError(
      'order.exit_not_amendable',
      `${input.instrument.ticker} at ${input.venue.id}`
    )
  }

  const limits = await input.venue.adapter.fetchLimits(resting.symbol, input.signal)
  const rounded = roundToInstrument({ limits, quantity: input.quantity })
  const exit = roundExitLevels(limits, input.exit)

  await amendExit({
    symbol: resting.symbol,
    exitId: resting.exitId,
    size: rounded.quantity,
    signal: input.signal,
    ...exit,
  })

  try {
    await deps.resting.amend({
      exitClientId: resting.exitClientId,
      quantity: rounded.quantity,
      signal: settleSignal(),
      ...exit,
    })
  } catch (err: unknown) {
    deps.logger.error('order.exit_row_stale', {
      exitClientId: resting.exitClientId,
      symbol: resting.symbol,
      err: formatErrForLog(err),
    })
  }

  return {
    action: 'amended',
    venue: input.venue.id,
    instrument: input.instrument,
    currency: input.currency,
    quantity: rounded.quantity,
    uncovered: uncoveredOf(input),
    ...exit,
  }
}

/** Every exit to cancel, newest first within one venue. Two venues are refused rather than picked
 *  between: cancelling either would leave the other resting behind a message saying it is gone. Two
 *  exits at one venue go together for the same reason — a request names an instrument and a
 *  venue, so there is no selector that could mean one of them. */
function resolveRestingExits(
  live: readonly RestingExit[],
  named: VenueRef | undefined
): readonly RestingExit[] {
  const candidates = named === undefined ? live : live.filter((entry) => entry.venue === named)
  const venues = [...new Set(candidates.map((entry) => entry.venue))]

  if (venues.length > 1) {
    throw new OrderError('order.venue_ambiguous', buildVenueList(venues))
  }

  return candidates
}

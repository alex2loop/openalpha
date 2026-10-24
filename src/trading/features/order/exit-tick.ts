import type { Logger } from '@/core/logging/logger'
import type { VenueFill } from '@/trading/features/ledger/sync'
import type { CloseReason } from '@/trading/features/ledger/types'
import type { RestingExitStore } from '@/trading/features/order/store/resting-exit'
import type { OrderReceipt, RestingExit } from '@/trading/features/order/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { OrderFill, OrderFilledListener } from '@/trading/kernel/operator/notice'
import type { BookedFill } from '@/trading/kernel/venue/fee'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildVenueFillKey } from '@/trading/features/ledger/sync'
import { resolveDay, resolveInstrument } from '@/trading/features/market-data/resolve'
import { announceFill, toMirrorNumbers } from '@/trading/features/order/mirror'
import { adapterFor } from '@/trading/features/order/routing'
import { OrderError } from '@/trading/features/order/types'
import { buildPositionKey } from '@/trading/kernel/instrument'

/** How long the exchange may go on denying an exit it should know before it is treated as gone. A
 *  moment of it is a read that raced a fill; five minutes of it is an order that no longer exists.
 *  A duration rather than a count of passes, so the verdict does not move with the tick's cadence. */
const EXIT_MISSING_GRACE_MS = 300_000

interface ExitTickDeps {
  readonly venues: VenueRegistry
  readonly resting: RestingExitStore
  readonly portfolio: Pick<PortfolioService, 'record' | 'positionsAt'>
  readonly markets: MarketRegistry
  readonly batchSize: number
  readonly logger: Logger
  /** Whether the book already holds this sale, under the venue's key or as a row typed by hand. */
  isFillBooked(fill: VenueFill, signal: AbortSignal): Promise<boolean>
  readonly onFilled: OrderFilledListener
  /** Tells the operator a sale this tick booked. Started, never awaited: see `settleFill`. */
  notifyFill(sale: VenueFill, signal: AbortSignal): Promise<void>
}

/** Rides the existing loop factory, so it owns no timer and no cadence: it holds a cursor in its
 *  closure and returns immediately when nothing rests. */
export function createExitTick(deps: ExitTickDeps): (signal: AbortSignal) => Promise<void> {
  let cursor: string | undefined

  return async (signal): Promise<void> => {
    const now = Date.now()
    const page = await deps.resting.listLive({
      limit: deps.batchSize,
      signal,
      ...(cursor === undefined ? {} : { cursor }),
    })

    if (page.items.length === 0) {
      cursor = undefined

      return
    }

    // One fold per pass, not per row: the book is the same for every exit on the page.
    const held = await heldQuantities(deps, now, signal)

    for (const exit of page.items) {
      await reconcileOne(deps, exit, { now, signal, held })
    }

    cursor = page.nextCursor
  }
}

interface MirrorFillInput {
  readonly exit: RestingExit
  readonly fill: OrderReceipt
  readonly now: number
  readonly signal: AbortSignal
}

interface TickPass {
  readonly now: number
  readonly signal: AbortSignal
  /** Booked quantity per position, for the divergence check. */
  readonly held: ReadonlyMap<string, number>
}

async function heldQuantities(
  deps: ExitTickDeps,
  now: number,
  signal: AbortSignal
): Promise<ReadonlyMap<string, number>> {
  const positions = await deps.portfolio.positionsAt({ now, signal })

  return new Map(
    positions.map((position) => [
      buildPositionKey(position.instrument, position.venue),
      position.quantity,
    ])
  )
}

/** One bad row must not stop the page, and a batch against a down exchange must not write one
 *  identical error per row — so the failure is logged once here and the loop continues. */
async function reconcileOne(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  try {
    await reconcile(deps, exit, pass)
  } catch (err: unknown) {
    deps.logger.warn('order.exit_reconcile_failed', {
      exitClientId: exit.exitClientId,
      symbol: exit.symbol,
      err: formatErrForLog(err),
    })
  }
}

async function reconcile(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  const venue = deps.venues.find(exit.venue)

  // Never `markClosed`: the order may still be live at an exchange this process can no longer
  // reach, and closing the row would tell the operator their stop-loss is gone when it is not.
  // Never `markMissing` either — that stamp measures an exchange denying the order exists, which
  // is a different fact from this process being unable to ask. The row stays live.
  if (venue?.adapter === undefined) {
    deps.logger.warn('order.exit_venue_unknown', {
      exitClientId: exit.exitClientId,
      venue: exit.venue,
    })

    return
  }

  // A venue that rests no exit has nothing resting to reconcile; the registry refuses a method
  // under an undeclared capability, so the row this reads can only predate the manifest.
  if (venue.adapter.fetchExit === undefined) {
    return
  }

  const status = await venue.adapter.fetchExit({
    symbol: exit.symbol,
    exitClientId: exit.exitClientId,
    signal: pass.signal,
  })

  if (status === undefined) {
    await onMissing(deps, exit, pass)

    return
  }

  // The exchange named it, whatever it went on to say about it, so any run of denials behind this
  // reply is over and the next one opens its own window.
  if (exit.firstMissedAt !== undefined) {
    await deps.resting.clearMissing(exit.exitClientId, pass.signal)
  }

  if (status.state === 'canceled' || status.state === 'failed') {
    await deps.resting.markClosed(exit.exitClientId, pass.signal)

    return
  }

  if (status.state === 'live') {
    warnIfDiverged(deps, exit, pass.held)

    return
  }

  // A fill is attached only once it was read back; a trigger still in flight carries none, and one
  // still filling is booked on a later pass, whole, rather than settled on its first part.
  if (status.fill === undefined || !isTerminalFill(status.fill)) {
    return
  }

  // The trigger fired and its order ended with nothing sold: no fill will ever arrive to settle it.
  if (status.fill.filledQuantity <= 0) {
    await deps.resting.markClosed(exit.exitClientId, pass.signal)

    return
  }

  await settleFill(deps, exit, { fill: status.fill, pass })
}

/** The sale is booked and the exit settled before anyone is told, so a listener or a channel that
 *  fails can never leave a filled exit looking live. The notice is started and not awaited: the
 *  tick walks every exit in turn, and a slow channel must not hold the next one. A crash between
 *  the booking and the notice loses the notice and keeps the ledger row. */
async function settleFill(
  deps: ExitTickDeps,
  exit: RestingExit,
  parts: { readonly fill: OrderReceipt; readonly pass: TickPass }
): Promise<void> {
  const { fill, pass } = parts
  const sale = await mirrorFill(deps, { exit, fill, now: pass.now, signal: pass.signal })

  await deps.resting.markSettled(exit.exitClientId, pass.signal)

  // Already booked by a `/record sync` the operator ran: nothing new to announce.
  if (sale === undefined) {
    return
  }

  announceFill(deps, toOrderFill(sale, { fill, now: pass.now }))
  deps.notifyFill(sale, pass.signal).catch((err: unknown) => {
    // Shutdown aborts the send; the sale is booked either way and nothing failed.
    if (!isAbortError(err)) {
      deps.logger.warn('trading.exit_fill_notice_failed', {
        exitClientId: exit.exitClientId,
        symbol: exit.symbol,
        err: formatErrForLog(err),
      })
    }
  })
}

function toOrderFill(
  sale: VenueFill,
  source: { readonly fill: OrderReceipt; readonly now: number }
): OrderFill {
  const { draft } = sale

  return {
    instrument: draft.instrument,
    venue: draft.venue,
    side: 'sell',
    quantity: draft.quantity,
    unitPrice: draft.unitPrice,
    currency: draft.currency,
    ...(draft.closeReason === undefined ? {} : { closeReason: draft.closeReason }),
    at: source.fill.filledAt ?? source.now,
  }
}

function isTerminalFill(fill: OrderReceipt): boolean {
  return fill.state !== 'live' && fill.state !== 'partially_filled'
}

/** Never cancels anything. A booked position that no longer covers a live exit is reported with
 *  both numbers and left alone: removing downside protection because a bookkeeping row changed is
 *  the automatic action this product refuses, and a mistyped `/record` must not be able to do it. */
function warnIfDiverged(
  deps: ExitTickDeps,
  exit: RestingExit,
  held: ReadonlyMap<string, number>
): void {
  const booked = held.get(buildPositionKey(exit.instrument, exit.venue)) ?? 0

  if (booked >= exit.quantity) {
    return
  }

  deps.logger.warn('order.exit_diverged', {
    exitClientId: exit.exitClientId,
    symbol: exit.symbol,
    resting: exit.quantity,
    booked,
  })
}

/** The sale this pass booked, or undefined when the book already held it.
 *
 *  The exit is dated by the session that produced it, from the fill's own stamp — never by
 *  `Date.now()`. This tick may run hours later and across a day boundary, and dating an exit to the
 *  day it was noticed puts a trade on a day it did not happen. */
async function mirrorFill(
  deps: ExitTickDeps,
  input: MirrorFillInput
): Promise<VenueFill | undefined> {
  const { exit, fill, now, signal } = input

  if (fill.filledAt === undefined) {
    throw new OrderError('order.unmirrorable', 'the venue named no fill time to date the exit by')
  }

  const resolution = await resolveInstrument(deps.markets, {
    ticker: exit.instrument.ticker,
    market: exit.instrument.market,
    signal,
  })

  if (resolution.kind === 'unresolved') {
    throw new OrderError('order.unmirrorable', `no market quotes ${exit.instrument.ticker}`)
  }

  const { adapter } = adapterFor(deps.venues, exit.venue)
  const numbers = await toMirrorNumbers({
    receipt: fill,
    side: 'sell',
    baseAsset: exit.instrument.ticker,
    quoteAsset: adapter.quoteAsset,
    priceOf: (asset, priceSignal) => adapter.fetchAssetPrice(asset, priceSignal),
    signal,
  })
  const booked = toExitFill(exit, fill, {
    at: resolveDay(resolution.market, fill.filledAt),
    currency: resolution.market.manifest.currency,
    numbers,
  })

  // Booked already, the row is settled without a second sale: a duplicate overstates cash or is
  // refused as exceeding the position, and a refusal leaves the exit guarding quantity it no longer
  // holds. A pass that books and fails before marking the row finds its own sale here next time.
  if (await deps.isFillBooked(booked, signal)) {
    return undefined
  }

  await deps.portfolio.record({ ...booked, now, signal })

  return booked
}

interface SaleParts {
  readonly at: TradingDay
  readonly currency: CurrencyCode
  readonly numbers: BookedFill
}

function toExitFill(exit: RestingExit, fill: OrderReceipt, sale: SaleParts): VenueFill {
  const closeReason = closeReasonOf(exit, fill.averagePrice)

  return {
    // The venue's key, the one `/record sync` books the same fill under: a sync that ran first has
    // already written this sale, and a sync that runs later recognises the row by its key.
    idempotencyKey: buildVenueFillKey(exit.venue, fill.orderId),
    draft: {
      kind: 'sell',
      at: sale.at,
      currency: sale.currency,
      instrument: exit.instrument,
      venue: exit.venue,
      quantity: sale.numbers.quantity,
      unitPrice: fill.averagePrice,
      fee: sale.numbers.fee,
      ...(closeReason === undefined ? {} : { closeReason }),
    },
  }
}

/** Which leg filled. `ExitStatus` never says, so it is read off the price against the levels that
 *  were resting — a gap through either level still lands nearer the one it crossed. */
function closeReasonOf(exit: RestingExit, price: number): CloseReason | undefined {
  if (exit.takeProfit === undefined) {
    return exit.stopLoss === undefined ? undefined : 'stop'
  }

  if (exit.stopLoss === undefined) {
    return 'target'
  }

  return Math.abs(price - exit.stopLoss) <= Math.abs(price - exit.takeProfit) ? 'stop' : 'target'
}

/** An unbroken run of explicit not-founds, never of failures: a failure throws and is logged by the
 *  caller, so an outage cannot age a live exit out of existence. */
async function onMissing(deps: ExitTickDeps, exit: RestingExit, pass: TickPass): Promise<void> {
  const { firstMissedAt } = exit

  if (firstMissedAt === undefined) {
    await deps.resting.markMissing({
      exitClientId: exit.exitClientId,
      at: pass.now,
      signal: pass.signal,
    })

    return
  }

  if (pass.now - firstMissedAt < EXIT_MISSING_GRACE_MS) {
    return
  }

  deps.logger.warn('order.exit_vanished', {
    exitClientId: exit.exitClientId,
    symbol: exit.symbol,
    missingForMs: pass.now - firstMissedAt,
  })
  await deps.resting.markClosed(exit.exitClientId, pass.signal)
}

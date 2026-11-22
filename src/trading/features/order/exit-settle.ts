import type { Logger } from '@/core/logging/logger'
import type { VenueFill } from '@/trading/features/ledger/sync'
import type { CloseReason } from '@/trading/features/ledger/types'
import type { RestingExitStore } from '@/trading/features/order/store/resting-exit'
import type { CancelExitOutcome, OrderReceipt, RestingExit } from '@/trading/features/order/types'
import type { PortfolioService } from '@/trading/features/portfolio/types'
import type { CurrencyCode, TradingDay } from '@/trading/kernel/instrument'
import type { OrderFill, OrderFilledListener } from '@/trading/kernel/operator/notice'
import type { BookedFill } from '@/trading/kernel/venue/fee'
import type { ExitLookup, ExitStatus } from '@/trading/kernel/venue/spot-adapter'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildVenueFillKey } from '@/trading/features/ledger/sync'
import { resolveFillDay, resolveInstrument } from '@/trading/features/market-data/resolve'
import { announceFill, settleSignal, toMirrorNumbers } from '@/trading/features/order/mirror'
import { adapterFor } from '@/trading/features/order/routing'
import { OrderError } from '@/trading/features/order/types'

const SETTLEMENT_OUTCOME = {
  open: 'unsettled',
  closed: 'cancelled',
  sold: 'filled',
} as const satisfies Record<ExitSettlement['kind'], CancelExitOutcome>

/** `open`: nothing settled, the row stays live for the next read. `closed`: gone with nothing sold.
 *  `sold`: the sale is booked and the row settled; `notice` is absent when the book already held the
 *  sale, so there is nothing new to tell anyone. */
type ExitSettlement =
  | { readonly kind: 'open' }
  | { readonly kind: 'closed' }
  | { readonly kind: 'sold'; readonly notice?: OrderFill }

/** What turns an exit's status into a settled row and a booked sale. Shared by the exit tick and by
 *  a cancel, so a sale is booked the same way whichever one reads it first. */
export interface ExitSettleDeps {
  readonly venues: VenueRegistry
  readonly resting: RestingExitStore
  readonly portfolio: Pick<PortfolioService, 'record' | 'dayAt'>
  readonly markets: MarketRegistry
  readonly logger: Logger
  /** Told of each sale once its ledger row is booked. */
  readonly onFilled: OrderFilledListener
  /** Tells the operator a sale a read booked. Started, never awaited: the exit tick walks every exit
   *  in turn, and a slow channel must not hold the next one. A crash between the booking and the
   *  notice loses the notice and keeps the ledger row. */
  notifyFill(fill: OrderFill, signal: AbortSignal): Promise<void>
  /** Whether the book already holds this sale, under the venue's key or as a row typed by hand. */
  isFillBooked(fill: VenueFill, signal: AbortSignal): Promise<boolean>
}

interface CancelledRead {
  readonly fetchExit: (lookup: ExitLookup) => Promise<ExitStatus | undefined>
  readonly now: number
}

/** The venue answers a cancel that lost the race to a fill or an earlier cancel as done, so the exit
 *  is read back and settled the way the exit tick settles it: a sale is booked, never lost behind a
 *  closed row. A read that fails leaves the row live - the tick settles it, and a failed read is
 *  never taken for a cancel. The read-back and the booking each run under a bound of its own, so a slow
 *  price fetch cannot turn a real fill into `unsettled`; the caller's signal is often the abort that
 *  interrupted the call, and the exit is already down at the venue. */
export async function settleCancelledExit(
  deps: ExitSettleDeps,
  exit: RestingExit,
  read: CancelledRead
): Promise<CancelExitOutcome> {
  try {
    const status = await read.fetchExit({
      symbol: exit.symbol,
      exitClientId: exit.exitClientId,
      signal: settleSignal(),
    })

    if (status === undefined) {
      return 'unsettled'
    }

    const settlement = await settleExitStatus(deps, exit, {
      status,
      now: read.now,
      signal: settleSignal(),
    })

    if (settlement.kind === 'sold' && settlement.notice !== undefined) {
      startFillNotice(deps, exit, { fill: settlement.notice, signal: settleSignal() })
    }

    return SETTLEMENT_OUTCOME[settlement.kind]
  } catch (err: unknown) {
    deps.logger.warn('order.exit_cancel_unsettled', {
      exitClientId: exit.exitClientId,
      symbol: exit.symbol,
      venue: exit.venue,
      err: formatErrForLog(err),
    })

    return 'unsettled'
  }
}

interface SettleInput {
  readonly status: ExitStatus
  readonly now: number
  readonly signal: AbortSignal
}

/** The sale is booked and the exit settled before anyone is told, so a listener that fails can
 *  never leave a filled exit looking live. A fill is attached only once it was read back; a trigger
 *  still in flight carries none, and one still filling is booked on a later read, whole, rather than
 *  settled on its first part. */
export async function settleExitStatus(
  deps: ExitSettleDeps,
  exit: RestingExit,
  input: SettleInput
): Promise<ExitSettlement> {
  const { status, now, signal } = input

  if (status.state === 'canceled' || status.state === 'failed') {
    await deps.resting.markClosed(exit.exitClientId, signal)

    return { kind: 'closed' }
  }

  if (status.state === 'live' || status.fill === undefined || !isTerminalFill(status.fill)) {
    return { kind: 'open' }
  }

  // The trigger fired and its order ended with nothing sold: no fill will ever arrive to settle it.
  if (status.fill.filledQuantity <= 0) {
    await deps.resting.markClosed(exit.exitClientId, signal)

    return { kind: 'closed' }
  }

  const { fill } = status
  const sale = await mirrorFill(deps, { exit, fill, now, signal })

  await deps.resting.markSettled(exit.exitClientId, signal)

  if (sale === undefined) {
    return { kind: 'sold' }
  }

  const notice = toOrderFill(sale, { fill, now })

  announceFill(deps, notice)

  return { kind: 'sold', notice }
}

function isTerminalFill(fill: OrderReceipt): boolean {
  return fill.state !== 'live' && fill.state !== 'partially_filled'
}

interface MirrorFillInput {
  readonly exit: RestingExit
  readonly fill: OrderReceipt
  readonly now: number
  readonly signal: AbortSignal
}

/** The sale this read booked, or undefined when the book already held it.
 *
 *  The exit is dated by the session that produced it, from the fill's own stamp - never by
 *  `Date.now()`. This may run hours later and across a day boundary, and dating an exit to the day
 *  it was noticed puts a trade on a day it did not happen. */
async function mirrorFill(
  deps: ExitSettleDeps,
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
    at: resolveFillDay(resolution.market, fill.filledAt, deps.portfolio),
    currency: resolution.market.manifest.currency,
    numbers,
  })

  // Booked already, the row is settled without a second sale: a duplicate overstates cash or is
  // refused as exceeding the position, and a refusal leaves the exit guarding quantity it no longer
  // holds. A pass that books and fails before marking the row finds its own sale here next time.
  if (await deps.isFillBooked(booked, signal)) {
    return undefined
  }

  // The figures are the venue's own: asking it again would re-fetch this fill and replace the
  // clamped fill day above with the market's unclamped one.
  await deps.portfolio.record({ ...booked, fillSource: 'venue', now, signal })

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
    // already written this sale, and a sync that runs later recognizes the row by its key.
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
 *  were resting - a gap through either level still lands nearer the one it crossed. */
function closeReasonOf(exit: RestingExit, price: number): CloseReason | undefined {
  if (exit.takeProfit === undefined) {
    return exit.stopLoss === undefined ? undefined : 'stop'
  }

  if (exit.stopLoss === undefined) {
    return 'target'
  }

  return Math.abs(price - exit.stopLoss) <= Math.abs(price - exit.takeProfit) ? 'stop' : 'target'
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

/** Started, never awaited: a refused or slow send must not hold the caller. Shutdown aborts the
 *  send; the sale is booked either way and nothing failed. */
export function startFillNotice(
  deps: ExitSettleDeps,
  exit: RestingExit,
  notice: { readonly fill: OrderFill; readonly signal: AbortSignal }
): void {
  deps.notifyFill(notice.fill, notice.signal).catch((err: unknown) => {
    if (!isAbortError(err)) {
      deps.logger.warn('trading.exit_fill_notice_failed', {
        exitClientId: exit.exitClientId,
        symbol: exit.symbol,
        err: formatErrForLog(err),
      })
    }
  })
}

import type { LedgerWriteResult } from '@/trading/features/ledger/types'
import type { OrderServiceDeps } from '@/trading/features/order/deps'
import type { RoutedVenue } from '@/trading/features/order/routing'
import type { ExecuteInput, OrderReceipt, OrderSide } from '@/trading/features/order/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { OrderFill } from '@/trading/kernel/operator/notice'
import type { BookedFill, FeePriceLookup } from '@/trading/kernel/venue/fee'
import { isAbortError, ValidationError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { buildVenueFillKey } from '@/trading/features/ledger/sync'
import { resolveDay } from '@/trading/features/market-data/resolve'
import { OrderError } from '@/trading/features/order/types'
import { isBookableFill, toBookedFill } from '@/trading/kernel/venue/fee'

const SETTLE_TIMEOUT_MS = 5_000
const MIRROR_ABORTED_FAILURE = 'order.mirror_aborted'

interface MirrorInput {
  readonly input: ExecuteInput
  readonly venue: RoutedVenue
  readonly receipt: OrderReceipt
}

/** The filled order plus what it books, threaded together because every step after the poll reads
 *  both and neither is meaningful alone. */
export interface FilledOrder {
  readonly input: ExecuteInput
  readonly receipt: OrderReceipt
  readonly numbers: BookedFill
  readonly write: LedgerWriteResult
  readonly venue: RoutedVenue
}

/** A fresh bound for the writes and cancel that follow an order leaving: the caller's signal is
 *  often the abort that interrupted it, and a call it refuses drops an order the exchange took. */
export function settleSignal(): AbortSignal {
  return AbortSignal.timeout(SETTLE_TIMEOUT_MS)
}

/** The fill becomes a ledger row and the intent is settled, in that order: the row is the fact and
 *  the intent is only what keeps an unwritten one visible. */
export async function mirrorFilledOrder(
  deps: OrderServiceDeps,
  parts: MirrorInput
): Promise<FilledOrder> {
  const { input, receipt, venue } = parts
  const numbers = await bookedNumbers(deps, parts)
  const write = await record(deps, { input, receipt, numbers, venue })

  announceFill(deps, {
    instrument: input.staged.instrument,
    venue: input.staged.venue,
    side: input.staged.side,
    quantity: numbers.quantity,
    unitPrice: receipt.averagePrice,
    currency: input.prepared.currency,
    at: receipt.filledAt ?? input.now,
  })
  await recordMirrored(deps, input, receipt)

  return { input, receipt, numbers, write, venue }
}

/** The row is booked, so a listener that throws is logged and dropped: showing a fill must never
 *  fail it, nor skip the exit guarding the position it opened. Shared with the exit tick, so the
 *  one key covers both paths. */
export function announceFill(
  deps: Pick<OrderServiceDeps, 'logger' | 'onFilled'>,
  fill: OrderFill
): void {
  try {
    deps.onFilled(fill)
  } catch (err: unknown) {
    deps.logger.warn('trading.fill_listener_failed', {
      venue: fill.venue,
      ticker: fill.instrument.ticker,
      err: formatErrForLog(err),
    })
  }
}

/** The row is already in the book, so a failure here must not skip the exit guarding the
 *  position it opened. The intent keeps its placement marker, so the order stays listed for the
 *  operator, not swept. */
async function recordMirrored(
  deps: OrderServiceDeps,
  input: ExecuteInput,
  receipt: OrderReceipt
): Promise<void> {
  try {
    await deps.intents.recordOutcome({
      token: input.staged.token,
      orderId: receipt.orderId,
      averagePrice: receipt.averagePrice,
      filledQuantity: receipt.filledQuantity,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.mirror_outcome_unrecorded', {
      clientOrderId: input.staged.clientOrderId,
      orderId: receipt.orderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
    })
  }
}

/** The coins moved and the fee convention refuses to book them. The intent has to carry that
 *  before the throw stands: a row with no failure is swept, and the fill goes with it. */
async function bookedNumbers(deps: OrderServiceDeps, parts: MirrorInput): Promise<BookedFill> {
  const { input, receipt, venue } = parts
  const { staged } = input

  try {
    return await toMirrorNumbers({
      receipt,
      side: staged.side,
      baseAsset: staged.instrument.ticker,
      quoteAsset: venue.adapter.quoteAsset,
      priceOf: (asset, signal) => venue.adapter.fetchAssetPrice(asset, signal),
      signal: input.signal,
    })
  } catch (err: unknown) {
    if (input.signal.aborted || isAbortError(err)) {
      await markUnmirrored(deps, input, { receipt, failure: MIRROR_ABORTED_FAILURE })

      throw err
    }

    const fields = {
      clientOrderId: staged.clientOrderId,
      orderId: receipt.orderId,
      symbol: staged.symbol,
      feeCurrency: receipt.feeCurrency,
      err: formatErrForLog(err),
    }

    // Still unlisted after the venue's re-reads: `/record sync` books it later, so this is a
    // degraded fill rather than a failed one.
    if (err instanceof OrderError && err.code === 'order.fee_unreported') {
      deps.logger.warn('order.fill_fee_unreported', fields)
    } else {
      deps.logger.error('order.fill_unbookable', fields)
    }

    // The thrown code, so the row says which refusal this was; anything else came out of the fee
    // lookup itself.
    await markUnmirrored(deps, input, {
      receipt,
      failure: err instanceof OrderError ? err.code : 'order.unmirrorable_fee',
    })

    throw err
  }
}

async function record(
  deps: OrderServiceDeps,
  filled: Omit<FilledOrder, 'write'>
): Promise<LedgerWriteResult> {
  const { input, numbers, receipt, venue } = filled

  try {
    return (
      (await bookedFill(deps, filled)) ??
      (await deps.portfolio.record({
        draft: {
          kind: input.staged.side,
          at: fillDayOf(deps, filled),
          currency: input.prepared.currency,
          instrument: input.staged.instrument,
          venue: input.staged.venue,
          quantity: numbers.quantity,
          unitPrice: receipt.averagePrice,
          fee: numbers.fee,
        },
        // The venue's key, the one `/record sync` and the exit tick book the same fill under: a
        // writer that comes second finds the row in the ledger's write lock and books nothing.
        idempotencyKey: buildVenueFillKey(venue.id, receipt.orderId),
        fillSource: 'venue',
        now: input.now,
        signal: input.signal,
      }))
    )
  } catch (err: unknown) {
    if (input.signal.aborted || isAbortError(err)) {
      await markUnmirrored(deps, input, { receipt, failure: MIRROR_ABORTED_FAILURE })

      throw err
    }

    deps.logger.error('order.ledger_mirror_failed', {
      clientOrderId: input.staged.clientOrderId,
      orderId: receipt.orderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
    })

    await markUnmirrored(deps, input, { receipt, failure: 'order.unmirrorable' })

    if (err instanceof ValidationError) {
      throw new OrderError('order.unmirrorable', 'the ledger refused the entry', err)
    }

    throw err
  }
}

/** The day the fill traded in, from its own stamp: the order may fill a session before this runs
 *  to its end, and the confirm's clock would put the trade on a day it did not happen. A fill the
 *  venue left unstamped falls back to the day it was prepared on. */
function fillDayOf(deps: OrderServiceDeps, filled: Omit<FilledOrder, 'write'>): TradingDay {
  const { input, receipt } = filled
  const market = deps.markets.find(input.staged.instrument.market)

  return market === null || receipt.filledAt === undefined
    ? input.prepared.day
    : resolveDay(market, receipt.filledAt)
}

/** `/record sync` may book this fill under the venue's key while the order is still polling. The
 *  row it wrote is the mirror, even where its figures differ in a hair from this receipt's, which
 *  the ledger would otherwise refuse as one key reused with another request. */
async function bookedFill(
  deps: OrderServiceDeps,
  filled: Omit<FilledOrder, 'write'>
): Promise<LedgerWriteResult | undefined> {
  const { input, receipt, venue } = filled
  const entry = await deps.findRecordedFill(venue.id, receipt.orderId, input.signal)

  if (entry === undefined) {
    return undefined
  }

  const { book } = await deps.portfolio.viewAbsolute({ now: input.now, signal: input.signal })

  return { kind: 'recorded', entry, book }
}

interface Unmirrored {
  readonly receipt: OrderReceipt
  readonly failure: string
}

/** What keeps a lost fill charged against the caps and listed for the operator. A write that fails
 *  here must not also erase the error that caused it. Under its own bound, so a cancel still leaves
 *  the row. */
async function markUnmirrored(
  deps: OrderServiceDeps,
  input: ExecuteInput,
  unmirrored: Unmirrored
): Promise<void> {
  const { receipt } = unmirrored

  try {
    await deps.intents.recordOutcome({
      token: input.staged.token,
      orderId: receipt.orderId,
      averagePrice: receipt.averagePrice,
      filledQuantity: receipt.filledQuantity,
      failure: unmirrored.failure,
      signal: settleSignal(),
    })
  } catch (err: unknown) {
    deps.logger.error('order.unmirrored_unrecorded', {
      clientOrderId: input.staged.clientOrderId,
      orderId: receipt.orderId,
      symbol: input.staged.symbol,
      err: formatErrForLog(err),
    })
  }
}

interface MirrorNumbersInput {
  readonly receipt: OrderReceipt
  readonly side: OrderSide
  readonly baseAsset: string
  readonly quoteAsset: string
  readonly priceOf: FeePriceLookup
  readonly signal: AbortSignal
}

/** The order path refuses a fill it cannot price and a fee the convention does not cover rather
 *  than guessing either: an order this tree placed and cannot mirror must not reach the ledger as
 *  an invented row. `/record` degrades to the configured rate instead, because that trade happened
 *  either way. */
export async function toMirrorNumbers(input: MirrorNumbersInput): Promise<BookedFill> {
  const { receipt } = input

  if (!isBookableFill(receipt)) {
    throw new OrderError(
      'order.unpriced_fill',
      `order ${receipt.orderId} filled at a price the book cannot record`
    )
  }

  if (receipt.feeUnreported === true) {
    throw new OrderError(
      'order.fee_unreported',
      `the venue has not listed the trades of order ${receipt.orderId} yet`
    )
  }

  const numbers = await toBookedFill(input)

  if (numbers === undefined) {
    throw new OrderError(
      'order.unmirrorable_fee',
      `the fee of order ${receipt.orderId} needs a conversion this path will not guess`
    )
  }

  return numbers
}

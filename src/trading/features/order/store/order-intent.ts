import type {
  OrderSide,
  OrderType,
  StagedOrder,
  UnmirroredIntent,
} from '@/trading/features/order/types'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { marketRef, ticker, venueRef } from '@/trading/kernel/instrument'

const COLUMNS =
  'token, client_order_id, market, ticker, venue, symbol, side, order_type, quantity, limit_price, ' +
  'take_profit, stop_loss, quote_price, notional_base, created_at'
const COLUMN_COUNT = 15

interface IntentRow {
  readonly token: string
  readonly client_order_id: string
  readonly market: string
  readonly ticker: string
  readonly venue: string
  readonly symbol: string
  readonly side: string
  readonly order_type: string
  readonly quantity: number
  readonly limit_price: number | null
  readonly take_profit: number | null
  readonly stop_loss: number | null
  readonly quote_price: number
  readonly notional_base: number
  readonly created_at: number
}

/** `failure` is not nullable here: the only query building this row filters on it being set. */
interface UnmirroredRow {
  readonly token: string
  readonly market: string
  readonly ticker: string
  readonly venue: string
  readonly side: string
  readonly quantity: number
  readonly created_at: number
  readonly order_id: string | null
  readonly failure: string
  readonly filled_quantity: number | null
  readonly avg_price: number | null
}

/** Not the service's claim input: the store is told the cutoff rather than deriving it, because
 *  the confirm TTL is the service's to own. */
interface ClaimIntentInput {
  readonly token: string
  readonly notBefore: number
  readonly now: number
  readonly signal: AbortSignal
}

interface OutcomeInput {
  readonly token: string
  readonly orderId?: string
  readonly averagePrice?: number
  readonly filledQuantity?: number
  readonly failure?: string
  readonly signal: AbortSignal
}

interface SweepInput {
  readonly before: number
  readonly signal: AbortSignal
}

interface StagedListInput {
  /** The oldest a row may be and still be quotable, so this lists exactly what a confirm would
   *  accept rather than rows the claim is about to refuse. */
  readonly notBefore: number
  readonly limit: number
  readonly signal: AbortSignal
}

/** What placed at the exchange and is not in the book: how many orders, and the cash the buys among
 *  them took. A sell's proceeds are not credited back, because they too have not been booked. */
export interface UnmirroredExposure {
  readonly count: number
  readonly spentBase: number
}

export interface OrderIntentStore {
  stage(order: StagedOrder, signal: AbortSignal): Promise<void>
  /** Consumes the token and returns its terms, or undefined when it is unknown, already used or
   *  older than `notBefore`. */
  claim(input: ClaimIntentInput): Promise<StagedOrder | undefined>
  /** Staged, unclaimed and still inside the confirm window, oldest first. */
  listStaged(input: StagedListInput): Promise<readonly StagedOrder[]>
  recordOutcome(input: OutcomeInput): Promise<void>
  unmirroredExposure(signal: AbortSignal): Promise<UnmirroredExposure>
  listUnmirrored(signal: AbortSignal): Promise<readonly UnmirroredIntent[]>
  /** False when the token names no unmirrored row, so a mistyped one never reads as settled. */
  clearUnmirrored(token: string, signal: AbortSignal): Promise<boolean>
  sweepExpired(input: SweepInput): Promise<void>
}

export function createOrderIntentStore(deps: StoreDeps): OrderIntentStore {
  return {
    stage: (order, signal) => stage(deps, order, signal),
    claim: (input) => claim(deps, input),
    listStaged: (input) => listStaged(deps, input),
    recordOutcome: (input) => recordOutcome(deps, input),
    unmirroredExposure: (signal) => unmirroredExposure(deps, signal),
    listUnmirrored: (signal) => listUnmirrored(deps, signal),
    clearUnmirrored: (token, signal) => clearUnmirrored(deps, token, signal),
    sweepExpired: (input) => sweepExpired(deps, input),
  }
}

async function stage(deps: StoreDeps, order: StagedOrder, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal)

  await deps.db.execute(
    `INSERT INTO order_intents (${COLUMNS}) VALUES (${deps.dialect.paramList(COLUMN_COUNT)})`,
    [
      order.token,
      order.clientOrderId,
      order.instrument.market,
      order.instrument.ticker,
      order.venue,
      order.symbol,
      order.side,
      order.orderType,
      order.quantity,
      order.limitPrice ?? null,
      order.takeProfit ?? null,
      order.stopLoss ?? null,
      order.quotePrice,
      order.notionalBase,
      order.createdAt,
    ]
  )
}

/** The conditional update decides, not the read: two confirms racing both see an unconsumed row,
 *  and only the one whose `UPDATE` changes it may place. A row that already names an order or
 *  carries a failure was placed once and is never claimable. */
async function claim(deps: StoreDeps, input: ClaimIntentInput): Promise<StagedOrder | undefined> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<IntentRow>(
    `SELECT ${COLUMNS} FROM order_intents ` +
      `WHERE token = ${p(1)} AND consumed_at IS NULL AND order_id IS NULL AND failure IS NULL ` +
      `AND created_at >= ${p(2)}`,
    [input.token, input.notBefore]
  )
  const row = rows[0]

  if (row === undefined) {
    return undefined
  }

  const consumed = await deps.db.execute(
    `UPDATE order_intents SET consumed_at = ${p(1)} ` +
      `WHERE token = ${p(2)} AND consumed_at IS NULL AND order_id IS NULL AND failure IS NULL`,
    [input.now, input.token]
  )

  return consumed.changes === 1 ? toStagedOrder(row) : undefined
}

async function listStaged(
  deps: StoreDeps,
  input: StagedListInput
): Promise<readonly StagedOrder[]> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<IntentRow>(
    `SELECT ${COLUMNS} FROM order_intents WHERE consumed_at IS NULL AND order_id IS NULL ` +
      `AND failure IS NULL AND created_at >= ${p(1)} ORDER BY created_at LIMIT ${p(2)}`,
    [input.notBefore, input.limit]
  )

  return rows.map(toStagedOrder)
}

async function recordOutcome(deps: StoreDeps, input: OutcomeInput): Promise<void> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param

  await deps.db.execute(
    `UPDATE order_intents SET order_id = ${p(1)}, avg_price = ${p(2)}, ` +
      `filled_quantity = ${p(3)}, failure = ${p(4)} WHERE token = ${p(5)}`,
    [
      input.orderId ?? null,
      input.averagePrice ?? null,
      input.filledQuantity ?? null,
      input.failure ?? null,
      input.token,
    ]
  )
}

async function unmirroredExposure(
  deps: StoreDeps,
  signal: AbortSignal
): Promise<UnmirroredExposure> {
  assertNotAborted(signal)

  const rows = await deps.db.query<{ readonly count: number; readonly spent_base: number }>(
    'SELECT COUNT(*) AS count, ' +
      "COALESCE(SUM(CASE WHEN side = 'buy' THEN notional_base ELSE 0 END), 0) AS spent_base " +
      'FROM order_intents WHERE failure IS NOT NULL'
  )
  const row = rows[0]

  return { count: Number(row?.count ?? 0), spentBase: Number(row?.spent_base ?? 0) }
}

async function listUnmirrored(
  deps: StoreDeps,
  signal: AbortSignal
): Promise<readonly UnmirroredIntent[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<UnmirroredRow>(
    'SELECT token, market, ticker, venue, side, quantity, created_at, order_id, failure, ' +
      'filled_quantity, avg_price ' +
      'FROM order_intents WHERE failure IS NOT NULL ORDER BY created_at'
  )

  return rows.map(toUnmirroredIntent)
}

/** The row leaves and its exposure with it. Nothing here touches the ledger: the operator settled
 *  the book themselves, and this says they did — which is why an age cap could never stand in for
 *  it. A cleared row is gone rather than flagged, because the table's only reader counts rows. */
async function clearUnmirrored(
  deps: StoreDeps,
  token: string,
  signal: AbortSignal
): Promise<boolean> {
  assertNotAborted(signal)

  const cleared = await deps.db.execute(
    `DELETE FROM order_intents WHERE token = ${deps.dialect.param(1)} AND failure IS NOT NULL`,
    [token]
  )

  return cleared.changes === 1
}

/** Expired intents and settled outcomes leave in one statement on the write path: no timer, no
 *  background task, and the only thing that touches this table is the only thing that cleans it.
 *  A row carrying a failure outlives the sweep whether or not the exchange named an order id — an
 *  unreachable confirmation is the case a human most has to reconcile, and `clearUnmirrored` is
 *  where they say they have. A claimed row ages from its claim, not its staging: an order still
 *  executing has no outcome to write to a row the sweep already took. */
async function sweepExpired(deps: StoreDeps, input: SweepInput): Promise<void> {
  assertNotAborted(input.signal)

  await deps.db.execute(
    `DELETE FROM order_intents WHERE COALESCE(consumed_at, created_at) < ${deps.dialect.param(1)} ` +
      'AND failure IS NULL',
    [input.before]
  )
}

/** The `side` and `order_type` casts are safe because both columns carry a CHECK admitting exactly
 *  the literals of their union — the database refuses any other value at write time. */
function toStagedOrder(row: IntentRow): StagedOrder {
  return {
    token: row.token,
    clientOrderId: row.client_order_id,
    instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
    venue: venueRef(row.venue),
    symbol: row.symbol,
    side: row.side as OrderSide,
    orderType: row.order_type as OrderType,
    quantity: row.quantity,
    quotePrice: row.quote_price,
    notionalBase: row.notional_base,
    createdAt: row.created_at,
    ...(row.limit_price === null ? {} : { limitPrice: row.limit_price }),
    ...(row.take_profit === null ? {} : { takeProfit: row.take_profit }),
    ...(row.stop_loss === null ? {} : { stopLoss: row.stop_loss }),
  }
}

/** The `side` cast is safe for the reason `toStagedOrder`'s is: the column's CHECK admits only the
 *  union's literals. */
function toUnmirroredIntent(row: UnmirroredRow): UnmirroredIntent {
  return {
    token: row.token,
    instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
    venue: venueRef(row.venue),
    side: row.side as OrderSide,
    quantity: row.quantity,
    createdAt: row.created_at,
    failure: row.failure,
    ...(row.order_id === null ? {} : { orderId: row.order_id }),
    ...(row.filled_quantity === null ? {} : { filledQuantity: row.filled_quantity }),
    ...(row.avg_price === null ? {} : { averagePrice: row.avg_price }),
  }
}

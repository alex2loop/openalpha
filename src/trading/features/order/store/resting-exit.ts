import type { RestingExit } from '@/trading/features/order/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { Page, PageOptions } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { marketRef, ticker, venueRef } from '@/trading/kernel/instrument'
import { toPage } from '@/trading/kernel/store/store-row'

const COLUMNS =
  'exit_client_id, exit_id, symbol, venue, market, ticker, quantity, ' +
  'take_profit, stop_loss, first_missed_at, placed_at'
const COLUMN_COUNT = 11
const LIVE_STATE = 'live'

interface RestingRow {
  readonly exit_client_id: string
  readonly exit_id: string
  readonly symbol: string
  readonly venue: string
  readonly market: string
  readonly ticker: string
  readonly quantity: number
  readonly take_profit: number | null
  readonly stop_loss: number | null
  readonly first_missed_at: number | null
  readonly placed_at: number
}

interface StateInput {
  readonly exitClientId: string
  readonly signal: AbortSignal
}

interface MissingInput {
  readonly exitClientId: string
  readonly at: number
  readonly signal: AbortSignal
}

interface AmendRestingInput {
  readonly exitClientId: string
  readonly quantity: number
  readonly takeProfit?: number
  readonly stopLoss?: number
  readonly signal: AbortSignal
}

export interface RestingExitStore {
  insert(exit: RestingExit, signal: AbortSignal): Promise<void>
  /** New levels and size for a row whose exit was moved at the venue. */
  amend(input: AmendRestingInput): Promise<void>
  /** Paged by id ascending so the keyset cursor is total: a reconcile pass walks every page, or
   *  rows past the batch size are silently skipped every tick. */
  listLive(options: PageOptions<string>): Promise<Page<RestingExit, string>>
  markSettled(exitClientId: string, signal: AbortSignal): Promise<void>
  markClosed(exitClientId: string, signal: AbortSignal): Promise<void>
  /** Stamps when the exchange first denied this order. Only the first stamp of a run stands, so a
   *  later denial never restarts the grace period the earlier one opened. */
  markMissing(input: MissingInput): Promise<void>
  /** The exchange answered, so the run of denials is over and the next one starts its own window. */
  clearMissing(exitClientId: string, signal: AbortSignal): Promise<void>
  /** Every live exit on one instrument, newest first. Plural because a second venue can hold
   *  one of its own, and a cancel that silently picked between them would leave a stop resting. */
  liveExits(instrument: InstrumentRef, signal: AbortSignal): Promise<readonly RestingExit[]>
}

export function createRestingExitStore(deps: StoreDeps): RestingExitStore {
  return {
    insert: (exit, signal) => insert(deps, exit, signal),
    amend: (input) => amend(deps, input),
    listLive: (options) => listLive(deps, options),
    markSettled: (exitClientId, signal) => setState(deps, 'settled', { exitClientId, signal }),
    markClosed: (exitClientId, signal) => setState(deps, 'closed', { exitClientId, signal }),
    markMissing: (input) => markMissing(deps, input),
    clearMissing: (id, signal) => clearMissing(deps, id, signal),
    liveExits: (instrument, signal) => liveExits(deps, instrument, signal),
  }
}

async function insert(deps: StoreDeps, exit: RestingExit, signal: AbortSignal): Promise<void> {
  assertNotAborted(signal)

  await deps.db.execute(
    `INSERT INTO resting_exits (${COLUMNS}, state) ` +
      `VALUES (${deps.dialect.paramList(COLUMN_COUNT + 1)})`,
    [
      exit.exitClientId,
      exit.exitId,
      exit.symbol,
      exit.venue,
      exit.instrument.market,
      exit.instrument.ticker,
      exit.quantity,
      exit.takeProfit ?? null,
      exit.stopLoss ?? null,
      exit.firstMissedAt ?? null,
      exit.placedAt,
      LIVE_STATE,
    ]
  )
}

async function amend(deps: StoreDeps, input: AmendRestingInput): Promise<void> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param

  // The venue accepted the amendment, which is the exchange naming the order: any run of denials
  // behind it is over, and a stale stamp would count toward the next one.
  await deps.db.execute(
    `UPDATE resting_exits SET quantity = ${p(1)}, take_profit = ${p(2)}, stop_loss = ${p(3)}, ` +
      `first_missed_at = NULL WHERE exit_client_id = ${p(4)}`,
    [input.quantity, input.takeProfit ?? null, input.stopLoss ?? null, input.exitClientId]
  )
}

async function listLive(
  deps: StoreDeps,
  options: PageOptions<string>
): Promise<Page<RestingExit, string>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const cursor = options.cursor ?? ''
  const rows = await deps.db.query<RestingRow>(
    `SELECT ${COLUMNS} FROM resting_exits WHERE state = ${p(1)} AND exit_client_id > ${p(2)} ` +
      `ORDER BY exit_client_id LIMIT ${p(3)}`,
    [LIVE_STATE, cursor, options.limit + 1]
  )

  return toPage(rows.map(toRestingExit), options.limit, (exit) => exit.exitClientId)
}

async function setState(
  deps: StoreDeps,
  state: 'settled' | 'closed',
  input: StateInput
): Promise<void> {
  const { exitClientId, signal } = input

  assertNotAborted(signal)

  const p = deps.dialect.param

  await deps.db.execute(`UPDATE resting_exits SET state = ${p(1)} WHERE exit_client_id = ${p(2)}`, [
    state,
    exitClientId,
  ])
}

async function markMissing(deps: StoreDeps, input: MissingInput): Promise<void> {
  assertNotAborted(input.signal)

  const p = deps.dialect.param

  await deps.db.execute(
    `UPDATE resting_exits SET first_missed_at = ${p(1)} ` +
      `WHERE exit_client_id = ${p(2)} AND first_missed_at IS NULL`,
    [input.at, input.exitClientId]
  )
}

async function clearMissing(
  deps: StoreDeps,
  exitClientId: string,
  signal: AbortSignal
): Promise<void> {
  assertNotAborted(signal)

  await deps.db.execute(
    `UPDATE resting_exits SET first_missed_at = NULL WHERE exit_client_id = ${deps.dialect.param(1)}`,
    [exitClientId]
  )
}

async function liveExits(
  deps: StoreDeps,
  instrument: InstrumentRef,
  signal: AbortSignal
): Promise<readonly RestingExit[]> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<RestingRow>(
    `SELECT ${COLUMNS} FROM resting_exits ` +
      `WHERE state = ${p(1)} AND market = ${p(2)} AND ticker = ${p(3)} ORDER BY placed_at DESC`,
    [LIVE_STATE, instrument.market, instrument.ticker]
  )

  return rows.map(toRestingExit)
}

function toRestingExit(row: RestingRow): RestingExit {
  return {
    exitClientId: row.exit_client_id,
    exitId: row.exit_id,
    symbol: row.symbol,
    venue: venueRef(row.venue),
    instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
    quantity: row.quantity,
    placedAt: row.placed_at,
    ...(row.first_missed_at === null ? {} : { firstMissedAt: row.first_missed_at }),
    ...(row.take_profit === null ? {} : { takeProfit: row.take_profit }),
    ...(row.stop_loss === null ? {} : { stopLoss: row.stop_loss }),
  }
}

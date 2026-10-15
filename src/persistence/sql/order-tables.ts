import { buildStateCheck } from '@/persistence/sql/syntax'

// Split out of `2026_07_10_000002_trading_tables.ts` on size, not on lifecycle: these statements
// belong to that migration's `up` and their names to its `TABLES_TO_DROP`, which is why
// `check-migration-rollback` follows the import rather than reading the migration file alone.
const ORDER_SIDES = ['buy', 'sell']
const ORDER_TYPES = ['market', 'limit']
const RESTING_EXIT_STATES = ['live', 'settled', 'closed']

// A staged intent and the outcome of placing it, in one row. `token` is what the operator quotes
// back to confirm and `client_order_id` is the exchange's own identity for the same order, so a
// lost response is recovered by lookup rather than by placing a second one. A row lives through
// four states: staged (`consumed_at` NULL), consumed, placed (`order_id` set), and placed-but-
// unmirrored (`order_id` and `failure` both set) — the last is the one a human still reconciles.
// Money columns are DOUBLE PRECISION for the same reason the ledger's are: a row can be quoted in
// any currency.
export const ORDER_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS order_intents (
    token TEXT PRIMARY KEY,
    client_order_id TEXT NOT NULL UNIQUE,
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    venue TEXT NOT NULL,
    symbol TEXT NOT NULL,
    ${buildStateCheck('side', ORDER_SIDES)},
    ${buildStateCheck('order_type', ORDER_TYPES)},
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    limit_price DOUBLE PRECISION,
    take_profit DOUBLE PRECISION,
    stop_loss DOUBLE PRECISION,
    quote_price DOUBLE PRECISION NOT NULL,
    notional_base DOUBLE PRECISION NOT NULL CHECK (notional_base >= 0),
    created_at BIGINT NOT NULL,
    consumed_at BIGINT,
    order_id TEXT,
    avg_price DOUBLE PRECISION,
    filled_quantity DOUBLE PRECISION,
    failure TEXT,
    CHECK ((order_type = 'limit') = (limit_price IS NOT NULL))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_order_intents_created ON order_intents (created_at)',

  // One live exit per entry, keyed by the id this tree minted rather than the exchange's, so a
  // reconcile pass addresses the same row whether or not the place response arrived.
  // `first_missed_at` is when the exchange started denying the order exists, cleared the moment it
  // answers again: a count of denials would measure passes rather than time, and its meaning would
  // move with the tick's configured cadence.
  `CREATE TABLE IF NOT EXISTS resting_exits (
    exit_client_id TEXT PRIMARY KEY,
    exit_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    venue TEXT NOT NULL,
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    quantity DOUBLE PRECISION NOT NULL CHECK (quantity > 0),
    take_profit DOUBLE PRECISION,
    stop_loss DOUBLE PRECISION,
    ${buildStateCheck('state', RESTING_EXIT_STATES)},
    first_missed_at BIGINT,
    placed_at BIGINT NOT NULL,
    CHECK (take_profit IS NOT NULL OR stop_loss IS NOT NULL)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_resting_exits_live ON resting_exits (state, placed_at)',
  // One row: one operator, one switch. A missing row is buying as usual, so a fresh install needs no
  // seed write. `halted_at` is when buying was switched off.
  `CREATE TABLE IF NOT EXISTS order_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    halted_at BIGINT
  )`,
]

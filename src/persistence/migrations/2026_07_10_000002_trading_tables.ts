import type { MigrationDown, MigrationUp } from '@/persistence/types'
import { ORDER_TABLES } from '@/persistence/sql/order-tables'
import { buildStateCheck, sqlTextValues } from '@/persistence/sql/syntax'

// Persistence cannot import trading, so every closed state list below is written once
// here and kept identical to its trading contract tuple by review. Market ids, regions, and
// segments are never CHECK-listed: manifests declare them, so a new country adds no DDL.
// The suggestion outcomes are the trading scored statuses plus its unfilled status.
const SUGGESTION_ACTIONS = ['buy', 'reduce', 'hold']
const CONVICTION_BANDS = ['low', 'medium', 'high']
const ALERT_CONDITIONS = ['above', 'below']
const ALERT_STATES = ['active', 'triggered', 'delivering', 'fired', 'disabled']
const BRIEF_DELIVERY_STATES = ['scheduled', 'delivering', 'disabled']
const INSTRUMENT_STATUSES = ['active', 'halted', 'delisted', 'unknown']
const BAR_ADJUSTMENTS = ['adjusted', 'raw']
const SUGGESTION_OUTCOMES = ['target', 'stop', 'expired', 'unfilled']
const INVESTMENT_HORIZONS = ['short', 'long']
const FACTOR_LOG_EXIT_REASONS = ['window-end', 'stopped-trading']
const INSTRUMENT_KINDS = ['equity', 'etf', 'future', 'index', 'gold', 'fx', 'crypto']
const MACRO_DOCUMENT_KINDS = ['official', 'press']
const THEME_STATUSES = ['proposed', 'active', 'weakening', 'invalidated', 'rejected', 'retired']
const THEME_MATURITIES = ['emerging', 'scaling', 'mature']
const THEME_READ_LEVELS = ['theme', 'sector', 'stock']
const SCORE_CONFIDENCES = ['low', 'medium', 'high']
const REFRESH_DATA_KINDS = [
  'instruments',
  'bars',
  'fundamentals',
  'flows',
  'macro',
  'accounts',
  'premium',
  'funding',
]
// Every table `up` creates, so a rollback leaves nothing behind. No foreign keys between them,
// so the order is the declaration's, not a dependency's; `check-migration-rollback` fails if a
// table is added above and forgotten here.
const TABLES_TO_DROP = [
  'agent_focuses',
  'alerts',
  'annual_accounts',
  'brief_delivery',
  'brief_snapshots',
  'daily_bars',
  'daily_trade_sides',
  'factor_log',
  'foreign_flow_snapshots',
  'fundamental_snapshots',
  'funding_snapshots',
  'fx_rates',
  'instruments',
  'intraday_settings',
  'ledger_entries',
  'macro_documents',
  'macro_snapshots',
  'market_refresh_attempts',
  'nav_snapshots',
  'news_items',
  'order_intents',
  'order_settings',
  'quarterly_accounts',
  'resting_exits',
  'series_points',
  'series_provenance',
  'suggestions',
  'theme_outcomes',
  'theme_reads',
  'theme_runs',
  'themes',
  'trading_profiles',
] as const

// Cash kinds carry no market; a share-count adjustment carries no money at all. Both facts are
// CHECKs rather than conventions, so a malformed row cannot reach the fold.
const LEDGER_CASH_KINDS = ['deposit', 'withdrawal', 'fee', 'loss']
const LEDGER_TRADE_KINDS = ['buy', 'sell', 'rights']
const LEDGER_QUANTITY_KINDS = ['split', 'distribution']
const LEDGER_DIVIDEND_KIND = 'dividend'
const LEDGER_TRANSFER_KIND = 'transfer'
const LEDGER_TXN_KINDS = sqlTextValues([
  ...LEDGER_CASH_KINDS,
  ...LEDGER_TRADE_KINDS,
  ...LEDGER_QUANTITY_KINDS,
  LEDGER_DIVIDEND_KIND,
  LEDGER_TRANSFER_KIND,
])
// Cash and a transfer alike name a custodian and no instrument.
const INSTRUMENTLESS_KINDS = sqlTextValues([...LEDGER_CASH_KINDS, LEDGER_TRANSFER_KIND])
const TRANSFER_KIND = sqlTextValues([LEDGER_TRANSFER_KIND])
const TRADE_KINDS = sqlTextValues(LEDGER_TRADE_KINDS)
const QUANTITY_KINDS = sqlTextValues(LEDGER_QUANTITY_KINDS)
const AMOUNT_KINDS = sqlTextValues([
  ...LEDGER_CASH_KINDS,
  LEDGER_DIVIDEND_KIND,
  LEDGER_TRANSFER_KIND,
])

// One transaction is one row, edited and deleted in place. `id` is a UUIDv7, so it both keysets the
// history page and breaks ties between two transactions on the same day; `recorded_at` is when the
// row first appeared and `updated_at` when it was last edited, neither of which is the trading day;
// `at` and `settlement_day` are the trading days, so neither ends in `_at`.
//
// Every economic field is its own typed column. A ledger whose money lives in a JSON blob cannot be
// constrained (`amount > 0`), summed, or audited without deserializing every row in application
// code. `conversion` keeps only provenance — who said this rate and when — because `fx_rate` is what
// turns a native amount into a base-currency one and belongs beside the amount it multiplies.
//
// Money columns here are DOUBLE PRECISION in the transaction's own `currency`, not integer
// nano-USD: migration 000001's nano-USD policy covers this runtime's own single-currency USD
// accounting (LLM cost, scheduler-run cost). A ledger row can be VND, USD, or any other currency
// an operator trades in, so there is no single fixed-point scale that fits every row -- nano-USD
// specifically would either misrepresent a VND amount by nine orders of magnitude or require a
// second per-currency scale table. `ledger.ts`/`ledger-row.ts` read and write these as native
// floats; a future exact-money pass here would need its own per-currency minor-unit contract,
// not a reuse of `persistence/money.ts`.
const LEDGER_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    recorded_at BIGINT NOT NULL,
    updated_at BIGINT,
    idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    txn_kind TEXT NOT NULL CHECK (txn_kind IN (${LEDGER_TXN_KINDS})),
    at TEXT NOT NULL,
    settlement_day TEXT NOT NULL,
    market TEXT,
    ticker TEXT,
    venue TEXT,
    currency TEXT,
    fx_rate DOUBLE PRECISION,
    conversion TEXT,
    amount DOUBLE PRECISION,
    quantity DOUBLE PRECISION,
    unit_price DOUBLE PRECISION,
    fee DOUBLE PRECISION,
    quantity_delta DOUBLE PRECISION,
    note TEXT,
    close_reason TEXT,
    from_venue TEXT,
    CHECK (updated_at IS NULL OR updated_at >= recorded_at),
    CHECK ((txn_kind IN (${QUANTITY_KINDS})) =
      (currency IS NULL AND fx_rate IS NULL AND conversion IS NULL)),
    CHECK ((txn_kind IN (${INSTRUMENTLESS_KINDS})) = (market IS NULL AND ticker IS NULL)),
    -- market and ticker travel together: the biconditional above never forces this on its own,
    -- so a row could otherwise carry a market with no ticker. Cash and a transfer name a custodian
    -- without naming an instrument.
    CHECK ((market IS NULL) = (ticker IS NULL)),
    CHECK (venue IS NOT NULL),
    -- Exactly one amount shape per kind, so no row carries both a cash amount and a trade price.
    CHECK ((txn_kind IN (${AMOUNT_KINDS})) = (amount IS NOT NULL)),
    CHECK ((txn_kind IN (${TRADE_KINDS})) =
      (quantity IS NOT NULL AND unit_price IS NOT NULL AND fee IS NOT NULL)),
    CHECK ((txn_kind IN (${QUANTITY_KINDS})) = (quantity_delta IS NOT NULL)),
    -- from_venue is a transfer's source and belongs to no other kind. Its fee is stated rather
    -- than priced from a configured rate, so it is never absent either.
    CHECK ((txn_kind IN (${TRANSFER_KIND})) = (from_venue IS NOT NULL)),
    CHECK (txn_kind NOT IN (${TRANSFER_KIND}) OR fee IS NOT NULL),
    CHECK (amount IS NULL OR amount > 0),
    CHECK (quantity IS NULL OR quantity > 0),
    CHECK (unit_price IS NULL OR unit_price > 0),
    CHECK (fee IS NULL OR fee >= 0),
    CHECK (fx_rate IS NULL OR fx_rate > 0)
    -- quantity_delta is deliberately unconstrained in sign: a reverse split is negative.
  )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_idem ON ledger_entries (idempotency_key)',
  `CREATE TABLE IF NOT EXISTS nav_snapshots (
    day TEXT PRIMARY KEY,
    base_currency TEXT NOT NULL,
    nav_base DOUBLE PRECISION NOT NULL,
    cash_base DOUBLE PRECISION NOT NULL,
    net_deposits_base DOUBLE PRECISION NOT NULL,
    recorded_at BIGINT NOT NULL
  )`,
]

// One operator, so one profile: the CHECK is the whole singleton contract, and every read is a
// primary-key hit. `risk_level` is not a column — it is the conservative floor of capacity and
// willingness, derived by the row mapper.
const PROFILE_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS trading_profiles (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    preferred_locale TEXT NOT NULL,
    base_currency TEXT NOT NULL,
    risk_capacity TEXT NOT NULL,
    risk_willingness TEXT NOT NULL,
    goal TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
]

const SUGGESTION_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    strategy_id TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    focus_key TEXT NOT NULL DEFAULT 'default',
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    day TEXT NOT NULL,
    ${buildStateCheck('action', SUGGESTION_ACTIONS)},
    ${buildStateCheck('conviction', CONVICTION_BANDS)},
    authored_locale TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    is_call INTEGER NOT NULL DEFAULT 1 CHECK (is_call IN (0, 1)),
    outcome_status TEXT CHECK (outcome_status IS NULL OR outcome_status IN (${sqlTextValues(SUGGESTION_OUTCOMES)})),
    resolved_at BIGINT,
    exit_day TEXT,
    return_pct DOUBLE PRECISION,
    trailing_stop DOUBLE PRECISION,
    payload TEXT NOT NULL,
    CHECK ((outcome_status IS NULL) = (resolved_at IS NULL)),
    CHECK (outcome_status IS NULL OR action <> 'hold')
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_identity
    ON suggestions (market, ticker, strategy_id, strategy_version, focus_key, day)`,
  `CREATE INDEX IF NOT EXISTS idx_suggestions_pending
    ON suggestions (id) WHERE action <> 'hold' AND outcome_status IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_suggestions_resolved
    ON suggestions (resolved_at DESC) WHERE resolved_at IS NOT NULL`,
  // The focuses each agent has used, so a record survives an edit to the agent's `[focus]`.
  // `focus` is NULL for the default focus.
  `CREATE TABLE IF NOT EXISTS agent_focuses (
    agent_id TEXT NOT NULL,
    focus_key TEXT NOT NULL,
    focus TEXT,
    first_seen_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    PRIMARY KEY (agent_id, focus_key)
  )`,
]

// One row per (market, ticker, day, strategy_version): the whole screened board's factor scores,
// resolved against the forward return over the market's own horizon window. Kept identical to
// `INVESTMENT_HORIZONS` in trading by review; persistence cannot import it.
const FACTOR_LOG_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS factor_log (
    id TEXT PRIMARY KEY,
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    day TEXT NOT NULL,
    strategy_version TEXT NOT NULL,
    ${buildStateCheck('horizon', INVESTMENT_HORIZONS)},
    close DOUBLE PRECISION NOT NULL,
    payload TEXT NOT NULL,
    resolved_at BIGINT,
    exit_day TEXT,
    return_pct DOUBLE PRECISION,
    benchmark_return_pct DOUBLE PRECISION,
    exit_reason TEXT CHECK (exit_reason IN (${sqlTextValues(FACTOR_LOG_EXIT_REASONS)})),
    CHECK ((resolved_at IS NULL) = (return_pct IS NULL)),
    CHECK ((resolved_at IS NULL) = (exit_day IS NULL)),
    CHECK ((resolved_at IS NULL) = (exit_reason IS NULL))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_factor_log_identity
    ON factor_log (market, ticker, day, strategy_version)`,
  `CREATE INDEX IF NOT EXISTS idx_factor_log_pending
    ON factor_log (id) WHERE resolved_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_factor_log_resolved
    ON factor_log (resolved_at DESC)`,
]

// The partial unique index is the whole idempotency story: a repeated create loses the race and
// the store returns the live row. A fired or disabled alert is history, not a live duplicate, so
// it stays outside the index and the same identity is free to be re-armed.
const ALERT_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY,
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    ${buildStateCheck('condition', ALERT_CONDITIONS)},
    threshold DOUBLE PRECISION NOT NULL,
    channel TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    ${buildStateCheck('state', ALERT_STATES)},
    origin TEXT,
    created_at BIGINT NOT NULL,
    triggered_at BIGINT,
    observed_price DOUBLE PRECISION,
    next_due_at BIGINT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_token TEXT,
    lease_until BIGINT,
    last_error_code TEXT,
    fired_at BIGINT,
    disabled_at BIGINT,
    CHECK ((state = 'fired') = (fired_at IS NOT NULL)),
    CHECK ((state = 'disabled') = (disabled_at IS NOT NULL)),
    CHECK ((state = 'delivering') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
    CHECK (state IN ('active','disabled') OR triggered_at IS NOT NULL)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts (id) WHERE state = 'active'`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_fired
    ON alerts (fired_at DESC) WHERE state = 'fired'`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_due
    ON alerts (next_due_at) WHERE state IN ('triggered','delivering')`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_live
    ON alerts (market, ticker, condition, threshold, channel, chat_id)
    WHERE state IN ('active','triggered','delivering')`,

  // A system-armed row carries the deterministic identity its arming pass upserts against; an
  // operator-armed one leaves it NULL. Live-only, so a disabled row never blocks a re-arm.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_origin_live
    ON alerts (origin)
    WHERE origin IS NOT NULL AND state IN ('active','triggered','delivering')`,
]

// `next_delivery_day`/`next_due_at` are persisted, never computed in SQL: calendar rules belong to
// the brief service and the store only compares `next_due_at <= ?`. Both delivery tables name that
// column identically so one shared claim helper reads one column name.
const BRIEF_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS brief_snapshots (
    id TEXT PRIMARY KEY,
    day TEXT NOT NULL,
    authored_locale TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    payload TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_brief_identity
    ON brief_snapshots (day, authored_locale)`,
  'CREATE INDEX IF NOT EXISTS idx_brief_latest ON brief_snapshots (authored_locale, day DESC)',

  // One operator gets one morning brief, so this is a singleton row like `trading_profiles`. What
  // survives from the plural shape is the delivery state machine, which is durability rather than
  // plurality: one row still must not be double-sent by two daemon instances, and a failed send
  // still needs backoff. `send_time` is nullable — NULL means "follow config".
  `CREATE TABLE IF NOT EXISTS brief_delivery (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    region TEXT NOT NULL,
    channel TEXT NOT NULL,
    chat_id TEXT NOT NULL,
    send_time TEXT,
    ${buildStateCheck('state', BRIEF_DELIVERY_STATES)},
    last_delivered_day TEXT,
    next_delivery_day TEXT,
    next_due_at BIGINT,
    delivery_day TEXT,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    lease_token TEXT,
    lease_until BIGINT,
    last_error_code TEXT,
    disabled_at BIGINT,
    CHECK ((state = 'scheduled') = (next_delivery_day IS NOT NULL AND next_due_at IS NOT NULL)),
    CHECK ((state = 'delivering') = (delivery_day IS NOT NULL AND lease_token IS NOT NULL)),
    CHECK ((state = 'disabled') = (disabled_at IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_brief_delivery_due
    ON brief_delivery (next_due_at) WHERE state IN ('scheduled','delivering')`,
]

// `source_id` in every market-data key is what lets two providers' views of the same row coexist
// rather than overwrite each other — merging is a read-time decision owned by the source registry.
const MARKET_DATA_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS instruments (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    name TEXT NOT NULL,
    ${buildStateCheck('kind', INSTRUMENT_KINDS)},
    ${buildStateCheck('status', INSTRUMENT_STATUSES)},
    currency TEXT NOT NULL,
    exchange TEXT,
    sector TEXT,
    index_tier TEXT,
    listed_on TEXT,
    expires_on TEXT,
    foreign_ownership_pct DOUBLE PRECISION,
    foreign_ownership_limit_pct DOUBLE PRECISION,
    source_id TEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (market, ticker)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_instruments_screen ON instruments (market, status, kind)',
  'CREATE INDEX IF NOT EXISTS idx_instruments_fetched ON instruments (market, fetched_at)',

  // A session is one bar, whoever served it: `source_id` is which provider answered, not part of
  // what the row identifies. Keyed on the session alone, a restatement and a failover both upsert
  // over the day they supply and a response that omits a day leaves the stored one standing.
  `CREATE TABLE IF NOT EXISTS daily_bars (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    day TEXT NOT NULL,
    source_id TEXT NOT NULL,
    open DOUBLE PRECISION NOT NULL,
    high DOUBLE PRECISION NOT NULL,
    low DOUBLE PRECISION NOT NULL,
    close DOUBLE PRECISION NOT NULL,
    volume DOUBLE PRECISION NOT NULL,
    turnover DOUBLE PRECISION,
    ${buildStateCheck('adjustment', BAR_ADJUSTMENTS)},
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (market, ticker, day),
    CHECK (high >= low AND high >= open AND high >= close),
    CHECK (low <= open AND low <= close),
    CHECK (volume >= 0)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_bars_retention ON daily_bars (market, fetched_at)',

  `CREATE TABLE IF NOT EXISTS fundamental_snapshots (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    as_of TEXT NOT NULL,
    source_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    reported_on TEXT,
    fetched_at BIGINT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (market, ticker, as_of, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_fundamentals_retention
    ON fundamental_snapshots (market, fetched_at)`,
  `CREATE TABLE IF NOT EXISTS annual_accounts (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    source_id TEXT NOT NULL,
    published_on TEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (market, ticker, fiscal_year)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_annual_accounts_retention
    ON annual_accounts (market, fetched_at)`,
  `CREATE TABLE IF NOT EXISTS quarterly_accounts (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    fiscal_year INTEGER NOT NULL,
    fiscal_quarter INTEGER NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
    source_id TEXT NOT NULL,
    published_on TEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (market, ticker, fiscal_year, fiscal_quarter)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quarterly_accounts_retention
    ON quarterly_accounts (market, fetched_at)`,

  `CREATE TABLE IF NOT EXISTS funding_snapshots (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    as_of TEXT NOT NULL,
    source_id TEXT NOT NULL,
    observed_at BIGINT NOT NULL,
    funding_daily_pct DOUBLE PRECISION NOT NULL,
    window_days DOUBLE PRECISION NOT NULL,
    open_interest_usd DOUBLE PRECISION,
    open_interest_ratio DOUBLE PRECISION,
    open_interest_sessions INTEGER,
    open_interest_change DOUBLE PRECISION,
    open_interest_change_sessions INTEGER,
    long_short_ratio DOUBLE PRECISION,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (market, ticker, as_of, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_funding_retention
    ON funding_snapshots (market, fetched_at)`,

  `CREATE TABLE IF NOT EXISTS foreign_flow_snapshots (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    day TEXT NOT NULL,
    source_id TEXT NOT NULL,
    currency TEXT NOT NULL,
    foreign_buy_value DOUBLE PRECISION NOT NULL,
    foreign_sell_value DOUBLE PRECISION NOT NULL,
    foreign_net_value DOUBLE PRECISION NOT NULL,
    proprietary_net_value DOUBLE PRECISION,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (market, ticker, day, source_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_foreign_flows_retention ON foreign_flow_snapshots (market, fetched_at)',

  // One settled session's matched volume by which side crossed the spread.
  `CREATE TABLE IF NOT EXISTS daily_trade_sides (
    market TEXT NOT NULL,
    ticker TEXT NOT NULL,
    day TEXT NOT NULL,
    source_id TEXT NOT NULL,
    buy_volume DOUBLE PRECISION NOT NULL,
    sell_volume DOUBLE PRECISION NOT NULL,
    auction_volume DOUBLE PRECISION NOT NULL,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (market, ticker, day, source_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_trade_sides_retention
    ON daily_trade_sides (market, fetched_at)`,

  // Written only after a kind settles: row presence is what proves settlement, so a crash mid-kind
  // leaves none and the next boot repairs it. Fixed cardinality, so retention never touches it.
  `CREATE TABLE IF NOT EXISTS market_refresh_attempts (
    market TEXT NOT NULL,
    ${buildStateCheck('kind', REFRESH_DATA_KINDS)},
    as_of TEXT NOT NULL,
    attempted_at BIGINT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY (market, kind)
  )`,

  // Keyed on formula_version so a formula change produces a new row rather than silently
  // rewriting the history a stored suggestion cited.
  `CREATE TABLE IF NOT EXISTS macro_snapshots (
    region TEXT NOT NULL,
    day TEXT NOT NULL,
    formula_version TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    regime TEXT NOT NULL,
    score_regime TEXT,
    payload TEXT NOT NULL,
    PRIMARY KEY (region, day, formula_version)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_macro_recent ON macro_snapshots (region, day DESC)',

  // One row per pair, overwritten in place: the last rate each conversion resolved to, so a book
  // whose provider declines is marked off the previous reading rather than left unpriced. No
  // history is kept — nothing reads a rate the valuation has already moved past. Fixed
  // cardinality, so retention never touches it.
  `CREATE TABLE IF NOT EXISTS fx_rates (
    from_currency TEXT NOT NULL,
    to_currency TEXT NOT NULL,
    rate DOUBLE PRECISION NOT NULL,
    as_of TEXT NOT NULL,
    source_id TEXT NOT NULL,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (from_currency, to_currency)
  )`,

  // One row per (series, trading day): the stored reference history behind percentile readings.
  // `day` is a YYYY-MM-DD TradingDay string, lexicographically sortable.
  `CREATE TABLE IF NOT EXISTS series_points (
    series_id TEXT NOT NULL,
    day TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    fetched_at BIGINT NOT NULL,
    PRIMARY KEY (series_id, day)
  )`,

  // One row per canonical URL; `market` and `ticker` name the read that first fetched it and stay
  // NULL for a feed no market owns.
  `CREATE TABLE IF NOT EXISTS news_items (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT,
    published_at BIGINT NOT NULL,
    source_id TEXT NOT NULL,
    market TEXT,
    ticker TEXT,
    fetched_at BIGINT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_news_items_fetched ON news_items (fetched_at)',
  'CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items (published_at)',

  // The sentence an extracted figure in `series_points` was read from, verbatim.
  `CREATE TABLE IF NOT EXISTS series_provenance (
    series_id TEXT NOT NULL,
    day TEXT NOT NULL,
    ${buildStateCheck('kind', MACRO_DOCUMENT_KINDS)},
    source_url TEXT NOT NULL,
    quote TEXT NOT NULL,
    model TEXT NOT NULL,
    extracted_at BIGINT NOT NULL,
    -- When the press item was published; NULL for the office, which nothing outranks.
    published_at BIGINT,
    PRIMARY KEY (series_id, day)
  )`,

  // Every report or press item the model answered for, so no document is billed twice.
  `CREATE TABLE IF NOT EXISTS macro_documents (
    url TEXT PRIMARY KEY,
    ${buildStateCheck('kind', MACRO_DOCUMENT_KINDS)},
    month TEXT,
    model TEXT NOT NULL,
    accepted INTEGER NOT NULL,
    extracted_at BIGINT NOT NULL
  )`,
]

// One row, one nullable column. A missing row means enabled: a fresh install schedules without a
// seed write, and "never touched the switch" and "switched it on" stay one state rather than two.
const INTRADAY_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS intraday_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    disabled_at BIGINT
  )`,
]

// A theme's identity and lifecycle; each run adds reads at three levels (the theme, a sector, a
// stock) and never rewrites one. A read's score and confidence are columns so outcomes can join on
// them; an unscored read leaves both null.
const THEME_TABLES: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    thesis TEXT NOT NULL,
    ${buildStateCheck('status', THEME_STATUSES)},
    ${buildStateCheck('maturity', THEME_MATURITIES)},
    invalidation TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    approved_at BIGINT,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS theme_runs (
    id TEXT PRIMARY KEY,
    theme_id TEXT,
    started_at BIGINT NOT NULL,
    finished_at BIGINT NOT NULL,
    prompt_version TEXT NOT NULL,
    score_version TEXT NOT NULL,
    cost_usd DOUBLE PRECISION NOT NULL,
    bundle TEXT NOT NULL,
    gaps TEXT NOT NULL,
    notes TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_theme_runs_started ON theme_runs (started_at)',
  `CREATE TABLE IF NOT EXISTS theme_reads (
    run_id TEXT NOT NULL,
    theme_id TEXT NOT NULL,
    ${buildStateCheck('level', THEME_READ_LEVELS)},
    subject TEXT NOT NULL,
    score INTEGER,
    confidence TEXT CHECK (confidence IS NULL OR confidence IN (${sqlTextValues(SCORE_CONFIDENCES)})),
    payload TEXT NOT NULL,
    PRIMARY KEY (run_id, theme_id, level, subject)
  )`,
  // Three rows per stock read, written with the run and resolved by the daemon loop once due.
  `CREATE TABLE IF NOT EXISTS theme_outcomes (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    theme_id TEXT NOT NULL,
    ticker TEXT NOT NULL,
    sector TEXT NOT NULL,
    horizon_months INTEGER NOT NULL,
    entry_day TEXT NOT NULL,
    entry_close DOUBLE PRECISION NOT NULL,
    entry_benchmark DOUBLE PRECISION NOT NULL,
    due_day TEXT NOT NULL,
    resolved_at BIGINT,
    exit_day TEXT,
    stock_return DOUBLE PRECISION,
    benchmark_return DOUBLE PRECISION
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_theme_outcomes_read
    ON theme_outcomes (run_id, theme_id, ticker, horizon_months)`,
  `CREATE INDEX IF NOT EXISTS idx_theme_outcomes_pending
    ON theme_outcomes (id) WHERE resolved_at IS NULL`,
]

export const up: MigrationUp = async (tx) => {
  for (const sql of [
    ...LEDGER_TABLES,
    ...PROFILE_TABLES,
    ...SUGGESTION_TABLES,
    ...FACTOR_LOG_TABLES,
    ...ALERT_TABLES,
    ...BRIEF_TABLES,
    ...MARKET_DATA_TABLES,
    ...INTRADAY_TABLES,
    ...THEME_TABLES,
    ...ORDER_TABLES,
  ]) {
    await tx.execute(sql)
  }
}

export const down: MigrationDown = async (tx) => {
  for (const table of TABLES_TO_DROP) {
    await tx.execute(`DROP TABLE IF EXISTS ${table}`)
  }
}

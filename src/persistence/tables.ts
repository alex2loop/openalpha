import { StorageError } from '@/core/errors'

// Names and primary keys are listed rather than discovered because neither engine exposes a
// portable catalog query. `check-table-registry` holds this against the migrations, so a table
// added there and forgotten here fails the gate rather than going invisible to `db stats`/`db
// export`.
export interface DbTable {
  readonly name: string
  /** Primary-key columns in declaration order; `db export` cursors pages on them. */
  readonly pk: readonly string[]
  /** Survives only if it was exported: the operator wrote it, or it records something that cannot
   *  be fetched again. Market data is absent because `refresh` re-derives every row of it. */
  readonly durable?: true
}

const CORE_TABLES = [
  { name: 'sessions', pk: ['id'], durable: true },
  { name: 'session_messages', pk: ['session_id', 'idx'], durable: true },
  { name: 'llm_attempts', pk: ['id'], durable: true },
  { name: 'bindings', pk: ['channel', 'chat_id'], durable: true },
  { name: 'agent_pauses', pk: ['agent_id'], durable: true },
  { name: 'social_networks', pk: ['name'], durable: true },
  { name: 'social_memberships', pk: ['agent_id', 'network'], durable: true },
  { name: 'social_writes', pk: ['id'] },
  { name: 'social_drafts', pk: ['id'], durable: true },
  { name: 'pairings', pk: ['code'] },
  { name: 'jobs', pk: ['id'], durable: true },
  { name: 'scheduler_runs', pk: ['id'] },
  { name: 'channel_state', pk: ['channel', 'key'] },
  { name: 'channel_inbox', pk: ['channel', 'update_id'] },
  { name: 'heartbeat_task_completions', pk: ['agent_id', 'task_name'] },
  { name: 'heartbeat_commitments', pk: ['id'] },
  { name: 'memory_kv', pk: ['agent_id', 'user_id', 'key'], durable: true },
  { name: 'runs', pk: ['run_id'] },
] as const satisfies readonly DbTable[]

// The data an operator actually accumulates: everything above is bounded by process lifetime,
// while these grow with the market and are what a 30 MB file is made of.
const TRADING_TABLES = [
  { name: 'instruments', pk: ['market', 'ticker'] },
  { name: 'daily_bars', pk: ['market', 'ticker', 'day'] },
  { name: 'foreign_flow_snapshots', pk: ['market', 'ticker', 'day', 'source_id'] },
  // Durable despite being market data: both sources answer with the session that is current
  // when they are read, so `refresh` can capture a settled tape once and never re-derive it.
  { name: 'daily_trade_sides', pk: ['market', 'ticker', 'day', 'source_id'], durable: true },
  // Durable despite being market data: the ratios endpoint answers with the latest period only, so
  // a snapshot of a fiscal quarter that has passed is not something `refresh` can derive again.
  { name: 'fundamental_snapshots', pk: ['market', 'ticker', 'as_of', 'source_id'], durable: true },
  // Not durable: the provider serves eight years on every call, so a reset refetches them.
  { name: 'annual_accounts', pk: ['market', 'ticker', 'fiscal_year'] },
  { name: 'quarterly_accounts', pk: ['market', 'ticker', 'fiscal_year', 'fiscal_quarter'] },
  { name: 'funding_snapshots', pk: ['market', 'ticker', 'as_of', 'source_id'] },
  { name: 'fx_rates', pk: ['from_currency', 'to_currency'] },
  // Durable despite being market data: `refresh` stamps only the current session's regime, so the
  // one each stored suggestion was sized under is never derived again.
  { name: 'macro_snapshots', pk: ['region', 'day', 'formula_version'], durable: true },
  // Durable despite being market data: a premium point prices a dealer board that no source keeps,
  // so a lost day is lost for good. The FX series beside it is refetched whole on every pass, and
  // one non-derivable series decides the table.
  { name: 'series_points', pk: ['series_id', 'day'], durable: true },
  // Durable: a feed rolls past a headline within days.
  { name: 'news_items', pk: ['id'], durable: true },
  // Durable: re-deriving a figure's sentence costs a model call.
  { name: 'series_provenance', pk: ['series_id', 'day'], durable: true },
  { name: 'macro_documents', pk: ['url'], durable: true },
  { name: 'market_refresh_attempts', pk: ['market', 'kind'] },
  { name: 'suggestions', pk: ['id'], durable: true },
  { name: 'agent_focuses', pk: ['agent_id', 'focus_key'], durable: true },
  { name: 'factor_log', pk: ['id'], durable: true },
  { name: 'ledger_entries', pk: ['id'], durable: true },
  { name: 'nav_snapshots', pk: ['day'], durable: true },
  { name: 'trading_profiles', pk: ['id'], durable: true },
  { name: 'alerts', pk: ['id'], durable: true },
  { name: 'brief_snapshots', pk: ['id'] },
  { name: 'brief_delivery', pk: ['id'], durable: true },
  { name: 'intraday_settings', pk: ['id'], durable: true },
  // Durable because neither a placed-but-unmirrored order nor a resting exit at the exchange can
  // be re-derived from any source this tree can fetch.
  { name: 'order_intents', pk: ['token'], durable: true },
  { name: 'order_settings', pk: ['id'], durable: true },
  { name: 'resting_exits', pk: ['exit_client_id'], durable: true },
  // Durable: a read is a model's answer on a bundle that cannot be rebuilt.
  { name: 'themes', pk: ['id'], durable: true },
  { name: 'theme_runs', pk: ['id'], durable: true },
  { name: 'theme_reads', pk: ['run_id', 'theme_id', 'level', 'subject'], durable: true },
  // Durable: an outcome is measured against bars a reset may no longer hold.
  { name: 'theme_outcomes', pk: ['id'], durable: true },
] as const satisfies readonly DbTable[]

const TABLES = [...CORE_TABLES, ...TRADING_TABLES] as const

/** Every registered name, so `dbTable` typos are compile errors rather than boot failures. */
type TableName = (typeof TABLES)[number]['name']

export const ALL_TABLES: readonly DbTable[] = TABLES
export const DURABLE_TABLES: readonly DbTable[] = ALL_TABLES.filter((table) => table.durable)
export const TABLE_NAME_WIDTH = Math.max(...ALL_TABLES.map((table) => table.name.length))
/** Every registered name, for a command that has to list them in an error. */
export const ALL_TABLE_NAMES: readonly string[] = ALL_TABLES.map((table) => table.name)

/** Resolve an operator-supplied name. `null` when it names no registered table. */
export function findTable(name: string): DbTable | null {
  return ALL_TABLES.find((table) => table.name === name) ?? null
}

/** One entry, for a caller that owns statements against a specific table and would otherwise
 *  restate its key columns. */
export function dbTable(name: TableName): DbTable {
  const found = ALL_TABLES.find((table) => table.name === name)

  if (found === undefined) {
    throw new StorageError(`unregistered table: ${name}`)
  }

  return found
}

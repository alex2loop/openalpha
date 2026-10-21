import type {
  CallAction,
  ListCallActionsOptions,
} from '@/trading/features/suggestion/store/call-actions'
import type { FindLatestExitPlanOptions } from '@/trading/features/suggestion/store/exit-plan'
import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { SuggestionPageOptions } from '@/trading/features/suggestion/store/suggestion-list'
import type {
  ClearRestatedOptions,
  CloseUnscorableOptions,
  CoverageOptions,
  FocusCall,
  ListResolvedOptions,
  RaiseTrailingStopOptions,
  SuggestionCoverageRow,
} from '@/trading/features/suggestion/store/suggestion-outcome'
import type { SuggestionRow } from '@/trading/features/suggestion/store/suggestion-row'
import type {
  ActionableStoredSuggestion,
  PriorThesis,
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionId,
  SuggestionIdentity,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import type { MarketRef, StrategyId, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { Page, PageOptions } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError } from '@/core/errors'
import { listCallActions } from '@/trading/features/suggestion/store/call-actions'
import { findLatestExitPlan } from '@/trading/features/suggestion/store/exit-plan'
import { readableRow } from '@/trading/features/suggestion/store/readable-row'
import { listSuggestionPage } from '@/trading/features/suggestion/store/suggestion-list'
import {
  clearRestated,
  closeUnscorable,
  coverage,
  listFocusCalls,
  listResolved,
  raiseTrailingStop,
  resolveOutcome,
  trailedStopToCarry,
} from '@/trading/features/suggestion/store/suggestion-outcome'
import { parseSuggestionPayload } from '@/trading/features/suggestion/store/suggestion-payload'
import {
  toActionable,
  toPayload,
  toSuggestion,
} from '@/trading/features/suggestion/store/suggestion-row'
import { isAnalystCall, suggestionId } from '@/trading/features/suggestion/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'
import { toPage } from '@/trading/kernel/store/store-row'

const INSERT_SQL =
  'INSERT INTO suggestions (id, strategy_id, strategy_version, focus_key, market, ticker, day, ' +
  'action, conviction, authored_locale, created_at, is_call, payload) VALUES '

interface FindRecentSuggestionOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly strategyId: StrategyId
  readonly strategyVersion: string
  readonly focusKey: FocusKey
  readonly sinceDay: TradingDay
  readonly signal: AbortSignal
}

interface FindLatestVerdictOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly signal: AbortSignal
}

interface FindPreviousThesisOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly focusKey: FocusKey
  readonly beforeDay: TradingDay
  readonly signal: AbortSignal
}

interface ReplaceSuggestionOptions {
  readonly previousId: SuggestionId
  readonly suggestion: StoredSuggestion
  readonly signal: AbortSignal
}

export interface SuggestionStore {
  findCompleted(identity: SuggestionIdentity, signal: AbortSignal): Promise<StoredSuggestion | null>
  findRecentCompleted(options: FindRecentSuggestionOptions): Promise<StoredSuggestion | null>
  findById(id: SuggestionId, signal: AbortSignal): Promise<StoredSuggestion | null>
  findLatestExitPlan(options: FindLatestExitPlanOptions): Promise<StoredSuggestion | null>
  /** The newest unresolved row for a name whatever its action, which is the only one that can speak
   *  for it: a later hold supersedes an earlier reduce, so reading the newest reduce alone would
   *  keep acting on a verdict the run after it withdrew. */
  findLatestVerdict(options: FindLatestVerdictOptions): Promise<StoredSuggestion | null>
  /** The standing thesis on a name: the newest actionable row before `beforeDay`. `null` when there
   *  is none, or when the newest one stated no invalidators — an older row is superseded, not a
   *  fallback. */
  findPreviousThesis(options: FindPreviousThesisOptions): Promise<PriorThesis | null>
  /** `false` when the economic identity already exists; `findCompleted` returns the row itself. */
  create(suggestion: StoredSuggestion, signal: AbortSignal): Promise<boolean>
  /** Takes over an identity held by a row that never reached a decision. `false` when a concurrent
   *  writer got there first, whose row is then the answer. */
  replace(options: ReplaceSuggestionOptions): Promise<boolean>
  listPendingActionable(
    options: PageOptions<SuggestionId>
  ): Promise<Page<ActionableStoredSuggestion, SuggestionId>>
  /** Every actionable row the book has ever held, counted per market and resolution state. */
  coverage(options: CoverageOptions): Promise<readonly SuggestionCoverageRow[]>
  /** One page of open verdicts or scored closes (`suggestion-list.ts`). */
  listPage(options: SuggestionPageOptions): Promise<Page<StoredSuggestion, SuggestionId>>
  /** Raises the plan's trailed stop, and only raises it: a lower level writes nothing. */
  raiseTrailingStop(options: RaiseTrailingStopOptions): Promise<boolean>
  /** Closes every open row on a name whose price history was re-adjusted. Returns the row count. */
  clearRestated(options: ClearRestatedOptions): Promise<number>
  /** Closes one open call that cannot be scored - its bars are gone, or its order never filled -
   *  with no result. `false` when it was no longer open. */
  closeUnscorable(options: CloseUnscorableOptions): Promise<boolean>
  resolve(id: SuggestionId, outcome: SuggestionOutcome, signal: AbortSignal): Promise<boolean>
  listResolved(options: ListResolvedOptions): Promise<readonly ResolvedActionableSuggestion[]>
  /** Every scored call, pooled across versions, whatever the row count; the caller folds repeats. */
  listFocusCalls(signal: AbortSignal): Promise<readonly FocusCall[]>
  /** The lean read agreement is measured on: no payload, the newest row per focus, name and day. */
  listCallActions(options: ListCallActionsOptions): Promise<readonly CallAction[]>
}

export function createSuggestionStore(deps: SuggestionStoreDeps): SuggestionStore {
  return {
    findCompleted: (identity, signal) => findCompleted(deps, identity, signal),
    findRecentCompleted: (options) => findRecentCompleted(deps, options),
    findById: (id, signal) => findById(deps, id, signal),
    findLatestExitPlan: (options) => findLatestExitPlan(deps, options),
    findLatestVerdict: (options) => findLatestVerdict(deps, options),
    findPreviousThesis: (options) => findPreviousThesis(deps, options),
    create: (suggestion, signal) => create(deps, suggestion, signal),
    replace: (options) => replace(deps, options),
    listPendingActionable: (options) => listPendingActionable(deps, options),
    coverage: (options) => coverage(deps, options),
    listPage: (options) => listSuggestionPage(deps, options),
    raiseTrailingStop: (options) => raiseTrailingStop(deps, options),
    clearRestated: (options) => clearRestated(deps, options),
    closeUnscorable: (options) => closeUnscorable(deps, options),
    resolve: (id, outcome, signal) => resolveOutcome(deps, { id, outcome, signal }),
    listResolved: (options) => listResolved(deps, options),
    listFocusCalls: (signal) => listFocusCalls(deps, signal),
    listCallActions: (options) => listCallActions(deps, options),
  }
}

async function findCompleted(
  deps: StoreDeps,
  identity: SuggestionIdentity,
  signal: AbortSignal
): Promise<StoredSuggestion | null> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE strategy_id = ${p(1)} ` +
      `AND strategy_version = ${p(2)} AND market = ${p(3)} AND ticker = ${p(4)} ` +
      `AND focus_key = ${p(5)} AND day = ${p(6)}`,
    [
      identity.strategyId,
      identity.strategyVersion,
      identity.market,
      identity.ticker,
      identity.focusKey,
      identity.asOf,
    ]
  )
  const row = rows[0]

  return row ? toSuggestion(row) : null
}

async function findById(
  deps: StoreDeps,
  id: SuggestionId,
  signal: AbortSignal
): Promise<StoredSuggestion | null> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<SuggestionRow>(`SELECT * FROM suggestions WHERE id = ${p(1)}`, [
    id,
  ])
  const row = rows[0]

  return row ? toSuggestion(row) : null
}

/** Matches every column of the identity index but the last, so `ORDER BY day DESC LIMIT 1` walks
 *  that index instead of range-scanning. */
async function findRecentCompleted(
  deps: StoreDeps,
  options: FindRecentSuggestionOptions
): Promise<StoredSuggestion | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND strategy_id = ${p(3)} AND strategy_version = ${p(4)} AND focus_key = ${p(5)} ` +
      `AND day >= ${p(6)} ORDER BY day DESC LIMIT 1`,
    [
      options.market,
      options.ticker,
      options.strategyId,
      options.strategyVersion,
      options.focusKey,
      options.sinceDay,
    ]
  )
  const row = rows[0]

  return row ? toSuggestion(row) : null
}

/** `day < beforeDay` is what makes a look-ahead read impossible and also skips the run's own
 *  same-day row on a forced re-run. */
async function findPreviousThesis(
  deps: StoreDeps,
  options: FindPreviousThesisOptions
): Promise<PriorThesis | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly day: string; readonly payload: string }>(
    `SELECT day, payload FROM suggestions WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND focus_key = ${p(3)} AND day < ${p(4)} AND action <> 'hold' ORDER BY day DESC LIMIT 1`,
    [options.market, options.ticker, options.focusKey, options.beforeDay]
  )
  const row = rows[0]

  if (!row) {
    return null
  }

  const invalidators = parseSuggestionPayload(row.payload).invalidators ?? []

  return invalidators.length === 0 ? null : { at: tradingDay(row.day), invalidators }
}

async function findLatestVerdict(
  deps: StoreDeps,
  options: FindLatestVerdictOptions
): Promise<StoredSuggestion | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND focus_key = ${p(3)} AND outcome_status IS NULL ORDER BY created_at DESC LIMIT 1`,
    [options.market, options.ticker, DEFAULT_FOCUS_KEY]
  )
  const row = rows[0]

  return row ? toSuggestion(row) : null
}

async function create(
  deps: StoreDeps,
  suggestion: StoredSuggestion,
  signal: AbortSignal
): Promise<boolean> {
  assertNotAborted(signal)

  const result = await deps.db.execute(buildInsertSql(deps), buildInsertParams(suggestion))

  return result.changes === 1
}

/** One transaction, so the identity is never briefly free for a third writer nor briefly held by
 *  two rows. A delete that finds nothing means another writer already took the row over; an insert
 *  that finds the id taken rolls the delete back rather than leaving the identity vacant. No spend
 *  is lost with the old row: an attempt's cost lives in `llm_attempts`. A stop the exit tick raised
 *  on it is carried to the new one. */
async function replace(deps: StoreDeps, options: ReplaceSuggestionOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param

  return deps.db.transaction(async (tx) => {
    const trailed = await trailedStopToCarry(deps, tx, options)
    const removed = await tx.execute(`DELETE FROM suggestions WHERE id = ${p(1)}`, [
      options.previousId,
    ])

    if (removed.changes !== 1) {
      return false
    }

    const result = await tx.execute(buildInsertSql(deps), buildInsertParams(options.suggestion))

    if (result.changes !== 1) {
      throw new StorageError(`suggestion ${options.suggestion.id} already exists`)
    }

    if (trailed !== undefined) {
      await tx.execute(`UPDATE suggestions SET trailing_stop = ${p(1)} WHERE id = ${p(2)}`, [
        trailed,
        options.suggestion.id,
      ])
    }

    return true
  })
}

function buildInsertSql(deps: StoreDeps): string {
  return `${INSERT_SQL}(${deps.dialect.paramList(13)}) ON CONFLICT DO NOTHING`
}

function buildInsertParams(suggestion: StoredSuggestion): readonly unknown[] {
  return [
    suggestion.id,
    suggestion.strategyId,
    suggestion.strategyVersion,
    suggestion.focusKey,
    suggestion.instrument.market,
    suggestion.instrument.ticker,
    suggestion.at,
    suggestion.action,
    suggestion.conviction,
    suggestion.authoredLocale,
    suggestion.createdAt,
    isAnalystCall(suggestion) ? 1 : 0,
    JSON.stringify(toPayload(suggestion)),
  ]
}

async function listPendingActionable(
  deps: SuggestionStoreDeps,
  options: PageOptions<SuggestionId>
): Promise<Page<ActionableStoredSuggestion, SuggestionId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  let where = "action <> 'hold' AND outcome_status IS NULL"

  if (options.cursor) {
    params.push(options.cursor)
    where += ` AND id > ${p(params.length)}`
  }

  params.push(options.limit + 1)

  // Ascending by id so a still-pending early suggestion cannot starve later ids across passes.
  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE ${where} ORDER BY id LIMIT ${p(params.length)}`,
    params
  )

  // Paged on the rows, not on what they parsed to, so the cursor clears one it could not read. A
  // dropped row keeps `outcome_status IS NULL`, which is where `coverage` reports it.
  const page = toPage(rows, options.limit, (row) => suggestionId(row.id))

  return {
    items: page.items.flatMap((row) => readableRow(row, toActionable, deps.logger)),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}

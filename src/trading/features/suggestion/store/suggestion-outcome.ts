import { z } from 'zod'

import type { Transaction } from '@/core/types/storage'
import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type { SuggestionRow } from '@/trading/features/suggestion/store/suggestion-row'
import type {
  ResolvedActionableSuggestion,
  StoredSuggestion,
  SuggestionDirection,
  SuggestionId,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import type { OutcomeStatus, SuggestionAction, UnscoredStatus } from '@/trading/kernel/conviction'
import type { InstrumentRef, MarketRef, Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { readableRow } from '@/trading/features/suggestion/store/readable-row'
import { toResolved } from '@/trading/features/suggestion/store/suggestion-row'
import { framedDirectionOf, planStopOf } from '@/trading/features/suggestion/types'
import { OUTCOME_STATUSES, SUGGESTION_ACTIONS, UNFILLED_STATUS } from '@/trading/kernel/conviction'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { toMember } from '@/trading/kernel/store/store-payload'
import { parseJson } from '@/trading/kernel/store/store-row'

/** The stored object as written, merged into rather than parsed: the read-time degradations of a
 *  stale enum must not be persisted back over the row. */
const RAW_PAYLOAD = z.record(z.string(), z.unknown())

/** A same-day re-run after a version bump stores the call again under the new version, so a read
 *  pooled across versions keeps only the newest row of each call. */
export const LATEST_OF_SAME_CALL_SQL =
  'NOT EXISTS (SELECT 1 FROM suggestions newer ' +
  'WHERE newer.strategy_id = suggestions.strategy_id AND newer.market = suggestions.market ' +
  'AND newer.ticker = suggestions.ticker AND newer.day = suggestions.day ' +
  'AND newer.focus_key = suggestions.focus_key ' +
  'AND newer.action = suggestions.action AND (newer.created_at > suggestions.created_at ' +
  'OR (newer.created_at = suggestions.created_at AND newer.id > suggestions.id)))'

/** A restated close is resolved with no return: it has no verdict to count. */
export const SCORED_SQL = 'resolved_at IS NOT NULL AND return_pct IS NOT NULL'
// A scoring pass resolves a batch at one instant: the later exit, then the newer call, breaks ties.
const RESOLVED_ORDER_SQL = 'resolved_at DESC, exit_day DESC, id DESC'

export interface ListResolvedOptions {
  readonly resolvedAfter?: number
  /** Only calls made on or before this day: the ones whose outcome window has elapsed. */
  readonly calledOnOrBefore?: TradingDay
  readonly strategyVersion?: string
  /** Only these focuses' calls. Omitted, every focus is read. */
  readonly focusKeys?: readonly FocusKey[]
  readonly market?: MarketRef
  readonly ticker?: Ticker
  readonly action?: SuggestionDirection
  readonly limit: number
  readonly signal: AbortSignal
}

export interface RaiseTrailingStopOptions {
  readonly id: SuggestionId
  readonly stop: number
  readonly signal: AbortSignal
}

export interface ClearRestatedOptions {
  readonly market: MarketRef
  readonly ticker: Ticker
  readonly now: number
  readonly signal: AbortSignal
}

export interface CloseUnscorableOptions {
  readonly id: SuggestionId
  readonly status: UnscoredStatus
  readonly now: number
  readonly signal: AbortSignal
}

interface ResolveOutcomeOptions {
  readonly id: SuggestionId
  readonly outcome: SuggestionOutcome
  readonly signal: AbortSignal
}

/** The caller has already compared against `planStopOf`, so the `trailing_stop <` guard closes only
 *  the race between two ticks: a stop may never move down, whichever of them lands second. */
export async function raiseTrailingStop(
  deps: StoreDeps,
  options: RaiseTrailingStopOptions
): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE suggestions SET trailing_stop = ${p(1)} WHERE id = ${p(2)} ` +
      `AND outcome_status IS NULL AND (trailing_stop IS NULL OR trailing_stop < ${p(3)})`,
    [options.stop, options.id, options.stop]
  )

  return result.changes === 1
}

/** A same-day re-run takes over the row the exit tick trailed. The trailed level is kept only where
 *  it sits above the fresh plan's stop on a plan that frames a long: a stop never moves down, and
 *  a sale has no stop to protect. Read before the delete. */
export async function trailedStopToCarry(
  deps: StoreDeps,
  tx: Transaction,
  carry: { readonly previousId: SuggestionId; readonly suggestion: StoredSuggestion }
): Promise<number | undefined> {
  const stop = planStopOf(carry.suggestion)

  if (stop === undefined || framedDirectionOf(carry.suggestion) !== 'buy') {
    return undefined
  }

  const rows = await tx.query<{ readonly trailing_stop: number | null }>(
    `SELECT trailing_stop FROM suggestions WHERE id = ${deps.dialect.param(1)} ` +
      'AND outcome_status IS NULL',
    [carry.previousId]
  )
  const trailed = rows[0]?.trailing_stop

  return trailed === null || trailed === undefined || trailed <= stop ? undefined : trailed
}

/** Everything on a name whose price history was re-adjusted that still names a price. The levels
 *  were absolute prices on a basis the series no longer publishes, so a stop of theirs is a number
 *  the market never traded at: scoring one would book a loss that did not happen, and arming one
 *  fires on the ex-date drop.
 *
 *  The two arms differ because the schema forbids a hold an outcome at all
 *  (`CHECK (outcome_status IS NULL OR action <> 'hold')`). An actionable call is expired with
 *  `exit_day` and `return_pct` left null, because there is no verdict to state: that null return is
 *  what reads it back as `restatedAt`, keeps it out of the track record, and stops the reuse gate
 *  serving its old-basis levels. Every hold is deleted instead: nothing scores one, and whichever
 *  is newest is what the exit tick arms from, so an older hold left behind would stand in for the
 *  deleted one with the same stale stop. Deleting them lets the next tick write fresh levels from
 *  the rebuilt series. */
export async function clearRestated(
  deps: StoreDeps,
  options: ClearRestatedOptions
): Promise<number> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param

  return await deps.db.transaction(async (tx) => {
    const expired = await tx.execute(
      `UPDATE suggestions SET outcome_status = 'expired', resolved_at = ${p(1)} ` +
        `WHERE market = ${p(2)} AND ticker = ${p(3)} AND outcome_status IS NULL ` +
        `AND action <> 'hold'`,
      [options.now, options.market, options.ticker]
    )
    const dropped = await tx.execute(
      `DELETE FROM suggestions WHERE market = ${p(1)} AND ticker = ${p(2)} AND action = 'hold'`,
      [options.market, options.ticker]
    )

    return expired.changes + dropped.changes
  })
}

/** A call with no result to state closes in `clearRestated`'s shape, with `exit_day` and
 *  `return_pct` left null and a status that says why: expired for a series that can no longer be
 *  read, unfilled for an order that never filled. A scored 'flat at the window's end' would
 *  count the missing evidence as a result; the null return keeps the row out of every scored
 *  population and out of the pending one it would otherwise sit in forever. */
export async function closeUnscorable(
  deps: StoreDeps,
  options: CloseUnscorableOptions
): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE suggestions SET outcome_status = ${p(1)}, resolved_at = ${p(2)} ` +
      `WHERE id = ${p(3)} AND outcome_status IS NULL AND action <> 'hold'`,
    [options.status, options.now, options.id]
  )

  return result.changes === 1
}

/** Guarded by `outcome_status IS NULL` rather than a version: every outcome field is written in
 *  the one statement that clears the null, so a retried daemon pass writes nothing and returns
 *  `false`. The benchmark return lives in the aggregate, so the payload is re-read inside the same
 *  transaction the guard runs in. */
export async function resolveOutcome(
  deps: StoreDeps,
  options: ResolveOutcomeOptions
): Promise<boolean> {
  const { id, outcome, signal } = options

  assertNotAborted(signal)

  const p = deps.dialect.param

  return deps.db.transaction(async (tx) => {
    assertNotAborted(signal)

    const rows = await tx.query<{ readonly payload: string }>(
      `SELECT payload FROM suggestions WHERE id = ${p(1)} AND outcome_status IS NULL`,
      [id]
    )
    const row = rows[0]

    if (!row) {
      return false
    }

    const payload = parseJson(row.payload, 'suggestion', (value) => RAW_PAYLOAD.parse(value))
    const result = await tx.execute(
      `UPDATE suggestions SET outcome_status = ${p(1)}, resolved_at = ${p(2)}, ` +
        `exit_day = ${p(3)}, return_pct = ${p(4)}, payload = ${p(5)} ` +
        `WHERE id = ${p(6)} AND outcome_status IS NULL`,
      [
        outcome.status,
        outcome.resolvedAt,
        outcome.exitDay,
        outcome.returnPct,
        JSON.stringify({
          ...payload,
          benchmarkReturnPct: outcome.benchmarkReturnPct,
          outcomeFormulaVersion: outcome.formulaVersion,
        }),
        id,
      ]
    )

    return result.changes === 1
  })
}

/** The optional day bounds, pushed into the query so the limit counts only rows that pass them. */
function dayClauses(
  options: ListResolvedOptions,
  params: unknown[],
  p: (index: number) => string
): string {
  let clauses = ''

  if (options.resolvedAfter !== undefined) {
    params.push(options.resolvedAfter)
    clauses += ` AND resolved_at > ${p(params.length)}`
  }

  if (options.calledOnOrBefore !== undefined) {
    params.push(options.calledOnOrBefore)
    clauses += ` AND day <= ${p(params.length)}`
  }

  return clauses
}

export async function listResolved(
  deps: SuggestionStoreDeps,
  options: ListResolvedOptions
): Promise<readonly ResolvedActionableSuggestion[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  let where = SCORED_SQL + dayClauses(options, params, p)

  if (options.strategyVersion === undefined) {
    where += ` AND ${LATEST_OF_SAME_CALL_SQL}`
  } else {
    params.push(options.strategyVersion)
    where += ` AND strategy_version = ${p(params.length)}`
  }

  if (options.focusKeys !== undefined) {
    const startAt = params.length + 1

    params.push(...options.focusKeys)
    where += ` AND focus_key IN (${deps.dialect.paramList(options.focusKeys.length, startAt)})`
  }

  if (options.market !== undefined) {
    params.push(options.market)
    where += ` AND market = ${p(params.length)}`
  }

  if (options.ticker !== undefined) {
    params.push(options.ticker)
    where += ` AND ticker = ${p(params.length)}`
  }

  if (options.action !== undefined) {
    params.push(options.action)
    where += ` AND action = ${p(params.length)}`
  }

  params.push(options.limit)

  const rows = await deps.db.query<SuggestionRow>(
    `SELECT * FROM suggestions WHERE ${where} ` +
      `ORDER BY ${RESOLVED_ORDER_SQL} LIMIT ${p(params.length)}`,
    params
  )

  return rows.flatMap((row) => readableRow(row, toResolved, deps.logger))
}

export const FOCUS_CALL_COLUMNS =
  'focus_key, market, ticker, day, action, outcome_status, exit_day, return_pct, resolved_at'

/** One scored call as the focus record reads it: no payload, only what the fold and the win
 *  count need. */
export interface FocusCall {
  readonly focusKey: FocusKey
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly action: SuggestionAction
  readonly outcome: {
    readonly exitDay: TradingDay
    readonly returnPct: number
    readonly status: OutcomeStatus
    readonly resolvedAt: number
  }
}

export interface FocusCallRow {
  readonly focus_key: string
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly action: string
  readonly outcome_status: string
  readonly exit_day: string
  readonly return_pct: number
  readonly resolved_at: number
}

/** The scored calls `listResolved` reads, pooled across versions, with no row limit so a busy book
 *  is never cut short. Only the columns the fold reads leave the table; the caller folds repeats
 *  with `independentCalls`, the one owner of that rule. */
export async function listFocusCalls(
  deps: StoreDeps,
  signal: AbortSignal
): Promise<readonly FocusCall[]> {
  assertNotAborted(signal)

  const rows = await deps.db.query<FocusCallRow>(
    `SELECT ${FOCUS_CALL_COLUMNS} ` +
      `FROM suggestions WHERE ${SCORED_SQL} AND exit_day IS NOT NULL ` +
      `AND ${LATEST_OF_SAME_CALL_SQL}`,
    []
  )

  return rows.map(toFocusCall)
}

export function toFocusCall(row: FocusCallRow): FocusCall {
  return {
    // why-safe: the column only ever holds `focusKey()` output.
    focusKey: row.focus_key as FocusKey,
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    at: tradingDay(row.day),
    action: toMember<SuggestionAction>(row.action, SUGGESTION_ACTIONS, 'suggestion action'),
    outcome: {
      exitDay: tradingDay(row.exit_day),
      returnPct: row.return_pct,
      status: toMember<OutcomeStatus>(row.outcome_status, OUTCOME_STATUSES, 'outcome status'),
      resolvedAt: row.resolved_at,
    },
  }
}

/** One market's rows at one resolution state: grouped, not filtered, so both sides of the
 *  denominator come from one scan and cannot disagree. */
export interface SuggestionCoverageRow {
  readonly market: MarketRef
  readonly state: CoverageState
  readonly count: number
}

type CoverageState = 'pending' | 'scored' | 'restated' | 'unfilled'

export interface CoverageOptions {
  /** Only these focuses' rows. Omitted, every focus is counted. */
  readonly focusKeys?: readonly FocusKey[]
  /** Only one version's rows, so the counts describe the population a version's rates read. */
  readonly strategyVersion?: string
  readonly signal: AbortSignal
}

export async function coverage(
  deps: StoreDeps,
  options: CoverageOptions
): Promise<readonly SuggestionCoverageRow[]> {
  assertNotAborted(options.signal)

  const params: unknown[] = [...(options.focusKeys ?? [])]
  const focusFilter =
    options.focusKeys === undefined
      ? ''
      : ` AND focus_key IN (${deps.dialect.paramList(params.length)})`

  if (options.strategyVersion !== undefined) {
    params.push(options.strategyVersion)
  }

  // The same split `listResolved` makes: a pinned version reads every row it wrote.
  const versionFilter =
    options.strategyVersion === undefined
      ? ` AND ${LATEST_OF_SAME_CALL_SQL}`
      : ` AND strategy_version = ${deps.dialect.param(params.length)}`

  // Actionable only, restating the table's own CHECK: a hold carries no entry to score against.
  // `CASE` rather than a bare `return_pct IS NULL` column, which reads back as 0/1 on sqlite and as
  // a boolean on Postgres.
  const rows = await deps.db.query<{
    readonly market: string
    readonly outcome_status: string | null
    readonly unscored: number
    readonly count: number
  }>(
    'SELECT market, outcome_status, ' +
      'CASE WHEN return_pct IS NULL THEN 1 ELSE 0 END AS unscored, COUNT(*) AS count ' +
      `FROM suggestions WHERE action <> 'hold'${focusFilter}` +
      `${versionFilter} GROUP BY market, outcome_status, unscored`,
    params
  )

  return rows.map((row) => ({
    market: marketRef(row.market),
    state: coverageStateOf(row.outcome_status, Number(row.unscored) === 1),
    // Postgres returns COUNT as a bigint, which arrives as a string.
    count: Number(row.count ?? 0),
  }))
}

/** NULL is the only unresolved status: a written one is always terminal, and a terminal row with no
 *  return is one a restatement closed. */
function coverageStateOf(status: string | null, unscored: boolean): CoverageState {
  if (status === null) {
    return 'pending'
  }

  if (status === UNFILLED_STATUS) {
    return 'unfilled'
  }

  return unscored ? 'restated' : 'scored'
}

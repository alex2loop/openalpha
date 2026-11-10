import { z } from 'zod'

import type { Dialect } from '@/core/types/storage'
import type { SuggestionStoreDeps } from '@/trading/features/suggestion/store/readable-row'
import type {
  CalculationVersion,
  SuggestionDirection,
  SuggestionId,
} from '@/trading/features/suggestion/types'
import type { OutcomeStatus, SuggestionAction } from '@/trading/kernel/conviction'
import type { InstrumentRef, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import type { InvestmentHorizon } from '@/trading/kernel/operator/profile'
import { assertNotAborted, StorageError } from '@/core/errors'
import { readableRow } from '@/trading/features/suggestion/store/readable-row'
import { buildResolvedWhere } from '@/trading/features/suggestion/store/suggestion-outcome'
import {
  calculationVersionSchema,
  readableHorizonSchema,
} from '@/trading/features/suggestion/store/suggestion-payload'
import { suggestionId } from '@/trading/features/suggestion/types'
import { OUTCOME_STATUSES, SUGGESTION_ACTIONS } from '@/trading/kernel/conviction'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { toMember } from '@/trading/kernel/store/store-payload'
import { parseJson, requireColumn } from '@/trading/kernel/store/store-row'

const LEAN_COLUMNS =
  'id, focus_key, market, ticker, day, action, strategy_version, outcome_status, exit_day, ' +
  'return_pct, resolved_at'

/** The payload fields a scored call needs beyond its columns: where each lives and what the
 *  column reads back as. Extracting them in SQL keeps the multi-kilobyte payload off the wire. */
const PAYLOAD_FIELDS = [
  { path: 'horizon', column: 'horizon' },
  { path: 'calculationVersions', column: 'calculation_versions' },
  { path: 'outcomeFormulaVersion', column: 'formula_version' },
] as const

const CALCULATION_VERSIONS_SCHEMA = z.array(calculationVersionSchema)

/** One scored call as the track record reads it before any cut: no payload, only what the fold,
 *  the win count and the version grouping need. */
export interface LeanCall {
  readonly id: SuggestionId
  readonly focusKey: FocusKey
  readonly instrument: InstrumentRef
  readonly at: TradingDay
  readonly action: SuggestionAction
  readonly horizon: InvestmentHorizon
  readonly strategyVersion: string
  readonly calculationVersions: readonly CalculationVersion[]
  readonly outcome: {
    readonly exitDay: TradingDay
    readonly returnPct: number
    readonly status: OutcomeStatus
    readonly resolvedAt: number
    readonly formulaVersion?: string
  }
}

export interface LeanCallRow {
  readonly id: string
  readonly focus_key: string
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly action: string
  readonly strategy_version: string
  readonly outcome_status: string
  readonly exit_day: string
  readonly return_pct: number
  readonly resolved_at: number
  readonly horizon: string | null
  /** The stored JSON array as text. */
  readonly calculation_versions: string | null
  readonly formula_version: string | null
}

export interface LeanCallOptions {
  /** Only these focuses' calls. Omitted, every focus is read. */
  readonly focusKeys?: readonly FocusKey[]
  readonly market?: MarketRef
  readonly action?: SuggestionDirection
  /** One version's rows. Omitted, the scored calls are pooled across versions. */
  readonly strategyVersion?: string
  readonly signal: AbortSignal
}

/** Every scored call `listResolved` reads for the same filters, with no row limit so a busy book is
 *  never cut short. The caller folds repeats with `independentCalls`, the one owner of that rule.
 *  A row whose payload names no readable horizon or versions leaves the read, logged once. */
export async function listLeanCalls(
  deps: SuggestionStoreDeps,
  options: LeanCallOptions
): Promise<readonly LeanCall[]> {
  assertNotAborted(options.signal)

  const params: unknown[] = []
  const where = buildResolvedWhere(deps.dialect, options, params)
  const rows = await deps.db.query<LeanCallRow>(
    `SELECT ${leanCallColumns(deps.dialect)} FROM suggestions WHERE ${where} ` +
      'AND exit_day IS NOT NULL',
    params
  )

  return rows.flatMap((row) => readableRow(row, toLeanCall, deps.logger))
}

export function leanCallColumns(dialect: Dialect): string {
  const fields = PAYLOAD_FIELDS.map(
    (field) => `${payloadFieldSql(dialect, field.path)} AS ${field.column}`
  )

  return [LEAN_COLUMNS, ...fields].join(', ')
}

/** One top-level payload field as text, extracted in SQL; shared with the factor log, whose rows
 *  keep their payload the same way. */
export function payloadFieldSql(dialect: Dialect, path: string): string {
  return dialect.name === 'postgres'
    ? `payload::jsonb ->> '${path}'`
    : `json_extract(payload, '$.${path}')`
}

export function toLeanCall(row: LeanCallRow): LeanCall {
  const formulaVersion = row.formula_version
  const horizon = readableHorizonSchema.safeParse(
    requireColumn(row.horizon, `suggestion ${row.id} has no horizon`)
  )

  if (!horizon.success) {
    throw new StorageError(`suggestion ${row.id} has an unreadable horizon`, horizon.error)
  }

  return {
    id: suggestionId(row.id),
    // why-safe: the column only ever holds `focusKey()` output.
    focusKey: row.focus_key as FocusKey,
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    at: tradingDay(row.day),
    action: toMember<SuggestionAction>(row.action, SUGGESTION_ACTIONS, 'suggestion action'),
    horizon: horizon.data,
    strategyVersion: row.strategy_version,
    calculationVersions: parseJson(
      requireColumn(row.calculation_versions, `suggestion ${row.id} has no calculation versions`),
      'suggestion calculation versions',
      (value) => CALCULATION_VERSIONS_SCHEMA.parse(value)
    ),
    outcome: {
      exitDay: tradingDay(row.exit_day),
      returnPct: row.return_pct,
      status: toMember<OutcomeStatus>(row.outcome_status, OUTCOME_STATUSES, 'outcome status'),
      resolvedAt: row.resolved_at,
      ...(formulaVersion === null ? {} : { formulaVersion }),
    },
  }
}

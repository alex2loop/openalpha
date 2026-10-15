import type { InstrumentStatus } from '@/trading/kernel/caveat'
import type {
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  VnIndexTier,
} from '@/trading/kernel/instrument'
import type { InstrumentRecord } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { foldText } from '@/core/utils/text'
import { INSTRUMENT_STATUSES } from '@/trading/kernel/caveat'
import {
  ticker as brandTicker,
  currencyCode,
  INSTRUMENT_KINDS,
  marketRef,
  tradingDay,
  VN_INDEX_TIERS,
} from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { toMember } from '@/trading/kernel/store/store-payload'

const INSTRUMENT_INSERT_SQL =
  'INSERT INTO instruments (market, ticker, name, kind, status, currency, exchange, sector, ' +
  'index_tier, listed_on, expires_on, foreign_ownership_pct, foreign_ownership_limit_pct, ' +
  'source_id, fetched_at) VALUES '

interface InstrumentRow {
  readonly market: string
  readonly ticker: string
  readonly name: string
  readonly kind: string
  readonly status: string
  readonly currency: string
  readonly exchange: string | null
  readonly sector: string | null
  readonly index_tier: string | null
  readonly listed_on: string | null
  readonly expires_on: string | null
  readonly foreign_ownership_pct: number | null
  readonly foreign_ownership_limit_pct: number | null
  readonly source_id: string
  readonly fetched_at: number
}

export interface ReplaceInstrumentsOptions {
  readonly market: MarketRef
  readonly records: readonly InstrumentRecord[]
  readonly signal: AbortSignal
}

export interface ListInstrumentsOptions {
  readonly market: MarketRef
  readonly status?: InstrumentStatus
  readonly kind?: InstrumentKind
  /** A search: tickers that start with it and names that contain it, ignoring case and Vietnamese
   *  marks. An exact ticker sorts first, then ticker starts, then name matches. */
  readonly search?: { readonly query: string; readonly limit: number }
  readonly signal: AbortSignal
}

/** Replaces the whole market scope in one transaction. The caller validates the universe first: a
 *  partial universe would otherwise delist every instrument the provider happened to omit. */
export async function replaceInstruments(
  deps: StoreDeps,
  options: ReplaceInstrumentsOptions
): Promise<void> {
  assertNotAborted(options.signal)

  if (options.records.length === 0) {
    return
  }

  const p = deps.dialect.param
  const insertSql = `${INSTRUMENT_INSERT_SQL}(${deps.dialect.paramList(15)})`

  await deps.db.transaction(async (tx) => {
    assertNotAborted(options.signal)
    await tx.execute(`DELETE FROM instruments WHERE market = ${p(1)}`, [options.market])
    assertNotAborted(options.signal)

    for (const record of options.records) {
      await tx.execute(insertSql, [
        record.instrument.market,
        record.instrument.ticker,
        record.name,
        record.kind,
        record.status,
        record.currency,
        record.exchange ?? null,
        record.sector ?? null,
        record.indexTier ?? null,
        record.listedOn ?? null,
        record.expiresOn ?? null,
        record.foreignOwnershipPct ?? null,
        record.foreignOwnershipLimitPct ?? null,
        record.sourceId,
        record.fetchedAt,
      ])
    }
  })
}

export async function listInstruments(
  deps: StoreDeps,
  options: ListInstrumentsOptions
): Promise<readonly InstrumentRecord[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = [options.market]
  let where = `market = ${p(1)}`

  if (options.status !== undefined) {
    params.push(options.status)
    where += ` AND status = ${p(params.length)}`
  }

  if (options.kind !== undefined) {
    params.push(options.kind)
    where += ` AND kind = ${p(params.length)}`
  }

  const rows = await deps.db.query<InstrumentRow>(
    `SELECT * FROM instruments WHERE ${where} ORDER BY ticker`,
    params
  )
  const records = rows.map(toInstrumentRecord)

  return options.search === undefined ? records : searchRecords(records, options.search)
}

/** -1 for no match; otherwise lower sorts first. */
function searchRank(record: InstrumentRecord, query: string): number {
  const symbol = foldText(record.instrument.ticker)

  if (symbol === query) {
    return 0
  }

  if (symbol.startsWith(query)) {
    return 1
  }

  return foldText(record.name).includes(query) ? 2 : -1
}

/** Folded in code, not SQL: a database folds ASCII case only, and nearly every VN name is accented.
 *  A market's catalog is a few thousand rows at most. */
function searchRecords(
  records: readonly InstrumentRecord[],
  search: { readonly query: string; readonly limit: number }
): readonly InstrumentRecord[] {
  const query = foldText(search.query)

  return records
    .map((record) => ({ record, rank: searchRank(record, query) }))
    .filter((entry) => entry.rank >= 0)
    .sort((left, right) => left.rank - right.rank)
    .slice(0, search.limit)
    .map((entry) => entry.record)
}

export async function findInstrument(
  deps: StoreDeps,
  options: { readonly instrument: InstrumentRef; readonly signal: AbortSignal }
): Promise<InstrumentRecord | null> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<InstrumentRow>(
    `SELECT * FROM instruments WHERE market = ${p(1)} AND ticker = ${p(2)}`,
    [options.instrument.market, options.instrument.ticker]
  )
  const row = rows[0]

  return row ? toInstrumentRecord(row) : null
}

/** Whether this market has a stored universe at all. `findInstrument` returning null cannot tell
 *  an unlisted name from a scope that was never refreshed; this separates the two without
 *  reading the scope. */
export async function hasInstruments(
  deps: StoreDeps,
  options: { readonly market: MarketRef; readonly signal: AbortSignal }
): Promise<boolean> {
  assertNotAborted(options.signal)

  const rows = await deps.db.query<{ readonly one: number }>(
    `SELECT 1 AS one FROM instruments WHERE market = ${deps.dialect.param(1)} LIMIT 1`,
    [options.market]
  )

  return rows.length > 0
}

function toInstrumentRecord(row: InstrumentRow): InstrumentRecord {
  return {
    sourceId: sourceId(row.source_id),
    fetchedAt: row.fetched_at,
    instrument: { market: marketRef(row.market), ticker: brandTicker(row.ticker) },
    name: row.name,
    kind: toMember<InstrumentKind>(row.kind, INSTRUMENT_KINDS, 'instrument kind'),
    status: toMember<InstrumentStatus>(row.status, INSTRUMENT_STATUSES, 'instrument status'),
    currency: currencyCode(row.currency),
    ...(row.exchange === null ? {} : { exchange: row.exchange }),
    ...(row.sector === null ? {} : { sector: row.sector }),
    ...(row.index_tier === null
      ? {}
      : { indexTier: toMember<VnIndexTier>(row.index_tier, VN_INDEX_TIERS, 'index tier') }),
    ...(row.listed_on === null ? {} : { listedOn: tradingDay(row.listed_on) }),
    ...(row.expires_on === null ? {} : { expiresOn: tradingDay(row.expires_on) }),
    ...(row.foreign_ownership_pct === null
      ? {}
      : { foreignOwnershipPct: row.foreign_ownership_pct }),
    ...(row.foreign_ownership_limit_pct === null
      ? {}
      : { foreignOwnershipLimitPct: row.foreign_ownership_limit_pct }),
  }
}

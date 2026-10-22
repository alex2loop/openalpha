import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type {
  FactorLogEntry,
  FactorLogId,
  FactorLogOutcome,
  FactorLogStore,
  PendingFactorLogEntry,
  ResolvedFactorLogEntry,
} from '@/trading/features/suggestion/track-record/factor-log-types'
import type { MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { TapeSignal } from '@/trading/kernel/market/tape'
import type { OperationTickOptions, Page } from '@/trading/kernel/store/page'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, StorageError, ValidationError } from '@/core/errors'
import { FACTOR_LOG_EXIT_REASONS } from '@/trading/features/suggestion/track-record/factor-log-types'
import { CONVICTION_BANDS } from '@/trading/kernel/conviction'
import { factorComposite, isFactorId } from '@/trading/kernel/factor'
import { brandFromPattern, marketRef, ticker, tradingDay } from '@/trading/kernel/instrument'
import { TAPE_SIGNALS } from '@/trading/kernel/market/tape'
import { INVESTMENT_HORIZONS } from '@/trading/kernel/operator/profile'
import { isSourceId } from '@/trading/kernel/source/source-id'
import { toMember } from '@/trading/kernel/store/store-payload'
import { parseJson, toBindChunks, toPage } from '@/trading/kernel/store/store-row'

const TABLE = 'factor_log'
const COLUMNS = [
  'id',
  'market',
  'ticker',
  'day',
  'strategy_version',
  'horizon',
  'close',
  'payload',
] as const
const ID_RE = /^[0-9a-f-]{36}$/

const factorSchema = z.strictObject({
  id: z.string(),
  score: z.number().finite(),
  weight: z.number().finite().optional(),
})

const payloadSchema = z.strictObject({
  composite: z.strictObject({
    score: z.number().finite(),
    band: z.enum(CONVICTION_BANDS),
    bearish: z.boolean(),
    bullish: z.boolean(),
    coverage: z.number().finite(),
    coverageBelowMinimum: z.boolean(),
    agreementBelowMinimum: z.boolean(),
    agreement: z.number().finite().optional(),
  }),
  factors: z.array(factorSchema),
  // A signal this build no longer publishes is dropped, the way a retired caveat code and a retired
  // metric id already are. Rejecting the array instead makes every row written before the retirement
  // unreadable, and the pending scan walks all of them — one stored member would stop the outcome
  // tick for the whole book rather than cost the one reading it named.
  signals: z
    .array(z.unknown())
    .transform((entries) => readableSignals(entries))
    .default([]),
  sources: z
    .array(z.string())
    .transform((ids) => ids.filter(isSourceId))
    .optional(),
})

function readableSignals(entries: readonly unknown[]): readonly TapeSignal[] {
  return entries.flatMap((entry) => {
    const parsed = z.enum(TAPE_SIGNALS).safeParse(entry)

    return parsed.success ? [parsed.data] : []
  })
}

interface FactorLogRow {
  readonly id: string
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly strategy_version: string
  readonly horizon: string
  readonly close: number
  readonly payload: string
  readonly resolved_at: number | null
  readonly exit_day: string | null
  readonly return_pct: number | null
  readonly benchmark_return_pct: number | null
  readonly exit_reason: string | null
}

function factorLogId(raw: string): FactorLogId {
  return brandFromPattern<FactorLogId>(raw, ID_RE, { label: 'factor log id' })
}

export function createFactorLogStore(deps: StoreDeps): FactorLogStore {
  return {
    hasDay: (market, day, signal) => hasDay(deps, { market, day, signal }),
    insertMany: (entries, signal) => insertMany(deps, entries, signal),
    listPending: (options) => listPending(deps, options),
    resolve: (id, outcome, signal) => resolve(deps, { id, outcome, signal }),
    closeUnscorable: (id, signal) => closeUnscorable(deps, id, signal),
    listResolved: (options) => listResolved(deps, options),
  }
}

interface HasDayOptions {
  readonly market: MarketRef
  readonly day: TradingDay
  readonly signal: AbortSignal
}

async function hasDay(deps: StoreDeps, options: HasDayOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<{ readonly id: string }>(
    `SELECT id FROM ${TABLE} WHERE market = ${p(1)} AND day = ${p(2)} LIMIT 1`,
    [options.market, options.day]
  )

  return rows.length > 0
}

/** Plain inserts, chunked to the bind ceiling, in one transaction: the capture gates on `hasDay`, so
 *  a board that stopped after its first chunk would never be completed. A duplicate identity only
 *  happens if two processes share a book; the unique index then rejects the board and the tick
 *  logs it and retries next interval. */
async function insertMany(
  deps: StoreDeps,
  entries: readonly FactorLogEntry[],
  signal: AbortSignal
): Promise<number> {
  assertNotAborted(signal)

  return await deps.db.transaction(async (tx) => {
    let written = 0

    for (const chunk of toBindChunks(entries, COLUMNS.length)) {
      const sql = deps.dialect.insert(TABLE, { cols: [...COLUMNS], rowCount: chunk.length })
      const result = await tx.execute(sql, chunk.flatMap(toInsertParams))

      written += result.changes
    }

    return written
  })
}

function toInsertParams(entry: FactorLogEntry): readonly unknown[] {
  return [
    randomUUID(),
    entry.instrument.market,
    entry.instrument.ticker,
    entry.day,
    entry.strategyVersion,
    entry.horizon,
    entry.close,
    JSON.stringify({
      composite: entry.composite,
      factors: entry.factors,
      signals: entry.signals,
      sources: entry.sources,
    }),
  ]
}

async function listPending(
  deps: StoreDeps,
  options: OperationTickOptions<FactorLogId>
): Promise<Page<PendingFactorLogEntry, FactorLogId>> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const params: unknown[] = []
  let where = 'resolved_at IS NULL'

  if (options.cursor !== undefined) {
    params.push(options.cursor)
    where += ` AND id > ${p(params.length)}`
  }

  params.push(options.batchSize + 1)

  const rows = await deps.db.query<FactorLogRow>(
    `SELECT * FROM ${TABLE} WHERE ${where} ORDER BY id LIMIT ${p(params.length)}`,
    params
  )

  // Paged on the rows, not on what they parsed to, so the cursor clears one it could not read.
  const page = toPage(rows, options.batchSize, (row) => factorLogId(row.id))

  return {
    items: page.items.flatMap(readablePending),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  }
}

/** A row whose payload no longer parses is skipped, so one corrupt row cannot stall the loop for
 *  every row behind it. Only a storage failure is skipped: anything else is a defect here. */
function readablePending(row: FactorLogRow): readonly PendingFactorLogEntry[] {
  try {
    return [toPending(row)]
  } catch (err: unknown) {
    if (err instanceof StorageError) {
      return []
    }

    throw err
  }
}

interface ResolveOptions {
  readonly id: FactorLogId
  readonly outcome: FactorLogOutcome
  readonly signal: AbortSignal
}

async function resolve(deps: StoreDeps, options: ResolveOptions): Promise<boolean> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `UPDATE ${TABLE} SET resolved_at = ${p(1)}, exit_day = ${p(2)}, return_pct = ${p(3)}, ` +
      `benchmark_return_pct = ${p(4)}, exit_reason = ${p(5)} WHERE id = ${p(6)} AND resolved_at IS NULL`,
    [
      options.outcome.resolvedAt,
      options.outcome.exitDay,
      options.outcome.returnPct,
      options.outcome.benchmarkReturnPct ?? null,
      options.outcome.exitReason,
      options.id,
    ]
  )

  return result.changes === 1
}

/** Deleted rather than closed: the schema ties `return_pct` to `resolved_at`, and a row nothing can
 *  score has no verdict to store. */
async function closeUnscorable(
  deps: StoreDeps,
  id: FactorLogId,
  signal: AbortSignal
): Promise<boolean> {
  assertNotAborted(signal)

  const p = deps.dialect.param
  const result = await deps.db.execute(
    `DELETE FROM ${TABLE} WHERE id = ${p(1)} AND resolved_at IS NULL`,
    [id]
  )

  return result.changes === 1
}

async function listResolved(
  deps: StoreDeps,
  options: { readonly limit: number; readonly signal: AbortSignal }
): Promise<readonly ResolvedFactorLogEntry[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<FactorLogRow>(
    `SELECT * FROM ${TABLE} WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT ${p(1)}`,
    [options.limit]
  )

  return rows.map(toResolved)
}

function toEntry(row: FactorLogRow): FactorLogEntry {
  const payload = parseJson(row.payload, 'factor log', (value) => payloadSchema.parse(value))

  return {
    instrument: { market: marketRef(row.market), ticker: ticker(row.ticker) },
    day: tradingDay(row.day),
    strategyVersion: row.strategy_version,
    horizon: toMember(row.horizon, INVESTMENT_HORIZONS, 'investment horizon'),
    close: row.close,
    composite: factorComposite(payload.composite),
    // A factor this build retired has nothing left to attribute to, so it drops out of the row.
    factors: payload.factors.flatMap((factor) =>
      isFactorId(factor.id)
        ? [
            {
              id: factor.id,
              score: factor.score,
              ...(factor.weight === undefined ? {} : { weight: factor.weight }),
            },
          ]
        : []
    ),
    signals: payload.signals,
    ...(payload.sources === undefined ? {} : { sources: payload.sources }),
  }
}

function toPending(row: FactorLogRow): PendingFactorLogEntry {
  return { ...toEntry(row), id: factorLogId(row.id) }
}

function toResolved(row: FactorLogRow): ResolvedFactorLogEntry {
  if (
    row.resolved_at === null ||
    row.exit_day === null ||
    row.return_pct === null ||
    row.exit_reason === null
  ) {
    throw new ValidationError(`factor log row ${row.id} is listed as resolved without an outcome`)
  }

  return {
    ...toEntry(row),
    outcome: {
      resolvedAt: row.resolved_at,
      exitDay: tradingDay(row.exit_day),
      returnPct: row.return_pct,
      exitReason: toMember(row.exit_reason, FACTOR_LOG_EXIT_REASONS, 'factor log exit reason'),
      ...(row.benchmark_return_pct === null
        ? {}
        : { benchmarkReturnPct: row.benchmark_return_pct }),
    },
  }
}

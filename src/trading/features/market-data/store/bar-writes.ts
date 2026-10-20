import type { InstrumentRef, MarketRef, TradingDay } from '@/trading/kernel/instrument'
import type { BarAdjustment, BarRecord } from '@/trading/kernel/market/market-data'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted, ValidationError } from '@/core/errors'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { BAR_ADJUSTMENTS } from '@/trading/kernel/market/market-data'
import { toMember } from '@/trading/kernel/store/store-payload'
import { toBindChunks } from '@/trading/kernel/store/store-row'

/** The session a bar belongs to, which is what the row is keyed on. */
const BAR_KEYS = ['market', 'ticker', 'day']
const BAR_VALUES = [
  'source_id',
  'open',
  'high',
  'low',
  'close',
  'volume',
  'turnover',
  'adjustment',
  'fetched_at',
]
const BAR_COLS = [...BAR_KEYS, ...BAR_VALUES]

/** Boundary reads run before the write and touch no rows the transaction will, so they overlap
 *  freely; the bound is on open handles, not on correctness. */
const CONTINUITY_READ_CONCURRENCY = 8

export interface UpsertBarsOptions {
  readonly market: MarketRef
  /** The window the pass fetched over. Where the adjustment basis is checked against the history on
   *  either side, and what `toDay` bounds the tail trim by. */
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly records: readonly BarRecord[]
  readonly signal: AbortSignal
}

interface InstrumentBars {
  readonly instrument: InstrumentRef
  readonly records: readonly BarRecord[]
}

interface BarTrim {
  readonly instrument: InstrumentRef
  /** The newest session this pass supplied. Everything stored above it, up to the window's own end,
   *  is a session the provider has stopped answering for. */
  readonly newest: TradingDay
}

interface ContinuityCheck {
  readonly instrument: InstrumentRef
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
  readonly records: readonly BarRecord[]
}

interface ContinuityPartition {
  readonly writable: readonly InstrumentBars[]
  /** Names whose new bars would have joined a different basis to the history around the window. */
  readonly conflicted: readonly InstrumentRef[]
}

interface AdjoiningBoundary {
  readonly side: 'before' | 'after'
  readonly boundary: TradingDay
}

/** Every session the pass fetched is written over the one stored for it, and no session it skipped
 *  inside the window is touched: a provider answering a name short leaves those days standing rather
 *  than erasing them, which is what a window-wide delete did — permanently, because the read's
 *  coverage tolerance counts sessions and then answered from the store without asking again. A
 *  restatement still lands, since it supplies the day it restates.
 *
 *  The tail past the newest session supplied is the exception, and trimmed. It is the only stretch
 *  `coversWindow` tests by date rather than by count, so a tail trimmed in error is re-fetched on
 *  the very next read while an interior day deleted in error never is. Without it a bar an adapter
 *  withheld as still forming stood as that session's close until a settled one replaced it
 *  overnight: on 2026-09-15 the guard stopped writing VN30F1M's 42,466-contract bar and `/price`
 *  went on serving the 1937.60 already stored against the 1948.1 the session actually closed at.
 *
 *  One commit for the whole pass — a commit per name made a board-wide refresh pay a thousand. */
export async function upsertBars(
  deps: StoreDeps,
  options: UpsertBarsOptions
): Promise<readonly InstrumentRef[]> {
  assertNotAborted(options.signal)

  // An inverted window is a caller bug, not an empty scope: no-oping here would let a swapped
  // fromDay/toDay read as "nothing to write" instead of failing loudly.
  if (options.fromDay > options.toDay) {
    throw new ValidationError(
      `upsertBars window is inverted: ${options.fromDay} > ${options.toDay}`
    )
  }

  if (options.records.length === 0) {
    return []
  }

  const { writable, conflicted } = await partitionByContinuity(
    deps,
    options,
    groupByInstrument(options)
  )

  await writeBars(deps, options, writable)

  return conflicted
}

/** One record per instrument and session, which is what the row is keyed on: a provider repeating a
 *  day would otherwise put the same key twice in one upsert, which Postgres refuses outright. The
 *  later record wins, since a response states its own newest reading last. A record naming another
 *  market belongs to no window this call may write and is a caller bug, not a row to drop. */
function groupByInstrument(options: UpsertBarsOptions): readonly InstrumentBars[] {
  const grouped = new Map<string, Map<TradingDay, BarRecord>>()

  for (const record of options.records) {
    if (record.instrument.market !== options.market) {
      throw new ValidationError(
        `upsertBars record ${buildInstrumentKey(record.instrument)} ` +
          `is outside ${options.market}`
      )
    }

    const held = grouped.get(record.instrument.ticker)

    if (held === undefined) {
      grouped.set(record.instrument.ticker, new Map([[record.candle.at, record]]))
      continue
    }

    held.set(record.candle.at, record)
  }

  return [...grouped.values()].flatMap((byDay) => {
    const records = [...byDay.values()]
    const first = records[0]

    return first === undefined ? [] : [{ instrument: first.instrument, records }]
  })
}

/** A source switch mid-series must not silently splice one adjustment basis onto another: a screener
 *  band spanning the join would read the step as a real price move. The name that would splice is
 *  dropped and reported; the rest of the pass is written, because one name that fell through to a
 *  raw-only provider is not a reason to lose the board's whole session. */
async function partitionByContinuity(
  deps: StoreDeps,
  options: UpsertBarsOptions,
  grouped: readonly InstrumentBars[]
): Promise<ContinuityPartition> {
  const verdicts = await mapWithConcurrency(grouped, CONTINUITY_READ_CONCURRENCY, async (entry) => {
    assertNotAborted(options.signal)

    return {
      entry,
      joins: await joinsForeignBasis(deps, {
        instrument: entry.instrument,
        fromDay: options.fromDay,
        toDay: options.toDay,
        records: entry.records,
      }),
    }
  })

  return {
    writable: verdicts.flatMap((verdict) => (verdict.joins ? [] : [verdict.entry])),
    conflicted: verdicts.flatMap((verdict) => (verdict.joins ? [verdict.entry.instrument] : [])),
  }
}

async function writeBars(
  deps: StoreDeps,
  options: UpsertBarsOptions,
  grouped: readonly InstrumentBars[]
): Promise<void> {
  // Every name conflicted: touch the database not at all rather than commit an empty transaction.
  if (grouped.length === 0) {
    return
  }

  const rowChunks = toBindChunks(
    grouped.flatMap((entry) => entry.records),
    BAR_COLS.length
  )
  const trims = grouped.flatMap((entry) => trimOf(entry, options.toDay))
  const p = deps.dialect.param

  await deps.db.transaction(async (tx) => {
    for (const chunk of rowChunks) {
      assertNotAborted(options.signal)
      await tx.execute(
        deps.dialect.upsert('daily_bars', {
          keys: BAR_KEYS,
          cols: BAR_VALUES,
          rowCount: chunk.length,
        }),
        chunk.flatMap(toBarValues)
      )
    }

    for (const trim of trims) {
      assertNotAborted(options.signal)
      await tx.execute(
        `DELETE FROM daily_bars WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
          `AND day > ${p(3)} AND day <= ${p(4)}`,
        [trim.instrument.market, trim.instrument.ticker, trim.newest, options.toDay]
      )
    }
  })
}

/** The stretch of window this name no longer carries, where it ends short of it. Empty for a name
 *  whose newest supplied session reaches `toDay`, which is every name on an ordinary pass — so a
 *  board-wide refresh issues a delete only for the handful that stopped early. */
function trimOf(entry: InstrumentBars, toDay: TradingDay): readonly BarTrim[] {
  const newest = entry.records.reduce(
    (latest, record) => (record.candle.at > latest ? record.candle.at : latest),
    entry.records[0]?.candle.at ?? toDay
  )

  return newest >= toDay ? [] : [{ instrument: entry.instrument, newest }]
}

/** Whether writing these records would join one adjustment basis to another. Checked only against
 *  the bars just outside the written window — records inside one call come from one fetch and are
 *  trusted to already agree on their own basis. */
async function joinsForeignBasis(deps: StoreDeps, options: ContinuityCheck): Promise<boolean> {
  const first = options.records.reduce((min, record) =>
    record.candle.at < min.candle.at ? record : min
  )
  const last = options.records.reduce((max, record) =>
    record.candle.at > max.candle.at ? record : max
  )
  const [before, after] = await Promise.all([
    adjoiningAdjustment(deps, options, { side: 'before', boundary: options.fromDay }),
    adjoiningAdjustment(deps, options, { side: 'after', boundary: options.toDay }),
  ])

  return (
    (before !== null && before !== first.candle.adjustment) ||
    (after !== null && after !== last.candle.adjustment)
  )
}

/** The one bar immediately outside the written window, on the named side — `null` when the
 *  series has no history there yet, which is never a discontinuity. */
async function adjoiningAdjustment(
  deps: StoreDeps,
  options: ContinuityCheck,
  boundary: AdjoiningBoundary
): Promise<BarAdjustment | null> {
  const p = deps.dialect.param
  const comparison = boundary.side === 'before' ? `day < ${p(3)}` : `day > ${p(3)}`
  const order = boundary.side === 'before' ? 'DESC' : 'ASC'
  const rows = await deps.db.query<{ readonly adjustment: string }>(
    `SELECT adjustment FROM daily_bars WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND ${comparison} ORDER BY day ${order} LIMIT 1`,
    [options.instrument.market, options.instrument.ticker, boundary.boundary]
  )
  const row = rows[0]

  return row ? toMember<BarAdjustment>(row.adjustment, BAR_ADJUSTMENTS, 'bar adjustment') : null
}

function toBarValues(record: BarRecord): readonly unknown[] {
  return [
    record.instrument.market,
    record.instrument.ticker,
    record.candle.at,
    record.sourceId,
    record.candle.open,
    record.candle.high,
    record.candle.low,
    record.candle.close,
    record.candle.volume,
    record.turnover ?? null,
    record.candle.adjustment,
    record.fetchedAt,
  ]
}

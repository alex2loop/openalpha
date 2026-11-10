import type { DayWindowOptions } from '@/trading/features/market-data/store/market-snapshot'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { BarAdjustment, BarRecord } from '@/trading/kernel/market/market-data'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { StoreDeps } from '@/trading/kernel/store/store-row'
import { assertNotAborted } from '@/core/errors'
import { ticker as brandTicker, marketRef, tradingDay } from '@/trading/kernel/instrument'
import { BAR_ADJUSTMENTS } from '@/trading/kernel/market/market-data'
import { sourceId } from '@/trading/kernel/source/source-id'
import { toMember } from '@/trading/kernel/store/store-payload'

interface BarRow {
  readonly market: string
  readonly ticker: string
  readonly day: string
  readonly source_id: string
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  readonly turnover: number | null
  readonly adjustment: string
  readonly fetched_at: number
}

/** The strings every bar repeats, held once per store. Bounded by the distinct trading days and
 *  sources ever read, so a read of the whole board keeps one copy of each day, not one per bar. */
interface BarStrings {
  readonly days: Map<string, TradingDay>
  readonly sources: Map<string, SourceId>
  readonly adjustments: Map<string, BarAdjustment>
}

function createBarStrings(): BarStrings {
  return { days: new Map(), sources: new Map(), adjustments: new Map() }
}

/** The bars of one name over a window, ascending. Rows are mapped so that a bar's repeated strings
 *  are shared across the board and one `instrument` object serves every bar of a name. */
export function barReader(
  deps: StoreDeps
): (options: DayWindowOptions) => Promise<readonly BarRecord[]> {
  const strings = createBarStrings()

  return (options) => listBars(deps, strings, options)
}

async function listBars(
  deps: StoreDeps,
  strings: BarStrings,
  options: DayWindowOptions
): Promise<readonly BarRecord[]> {
  assertNotAborted(options.signal)

  const p = deps.dialect.param
  const rows = await deps.db.query<BarRow>(
    `SELECT * FROM daily_bars WHERE market = ${p(1)} AND ticker = ${p(2)} ` +
      `AND day >= ${p(3)} AND day <= ${p(4)} ORDER BY day`,
    [options.instrument.market, options.instrument.ticker, options.fromDay, options.toDay]
  )
  const instruments = new Map<string, InstrumentRef>()

  return rows.map((row) => toBarRecord(strings, instruments, row))
}

function toBarRecord(
  strings: BarStrings,
  instruments: Map<string, InstrumentRef>,
  row: BarRow
): BarRecord {
  return {
    sourceId: interned(strings.sources, row.source_id, sourceId),
    fetchedAt: row.fetched_at,
    instrument: instrumentOf(instruments, row),
    candle: {
      at: interned(strings.days, row.day, tradingDay),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      adjustment: interned(strings.adjustments, row.adjustment, toAdjustment),
    },
    ...(row.turnover === null ? {} : { turnover: row.turnover }),
  }
}

function instrumentOf(instruments: Map<string, InstrumentRef>, row: BarRow): InstrumentRef {
  const key = `${row.market}/${row.ticker}`
  const known = instruments.get(key)

  if (known !== undefined) {
    return known
  }

  const created = { market: marketRef(row.market), ticker: brandTicker(row.ticker) }

  instruments.set(key, created)

  return created
}

function interned<T extends string>(
  pool: Map<string, T>,
  raw: string,
  brand: (raw: string) => T
): T {
  const known = pool.get(raw)

  if (known !== undefined) {
    return known
  }

  const created = brand(raw)

  pool.set(raw, created)

  return created
}

function toAdjustment(raw: string): BarAdjustment {
  return toMember<BarAdjustment>(raw, BAR_ADJUSTMENTS, 'bar adjustment')
}

import type { MarketDataService } from '@/trading/features/market-data/types'
import type {
  PendingOutcome,
  ThemeOutcomeResolution,
} from '@/trading/features/themes/outcomes/store'
import type { ThemeStore } from '@/trading/features/themes/store'
import type { ThemeOutcomeBatch } from '@/trading/features/themes/types'
import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { OperationTickOptions, Page } from '@/trading/kernel/store/page'
import { assertNotAborted } from '@/core/errors'
import { toDayBefore } from '@/trading/features/themes/evidence/series'
import { THEME_BENCHMARK, THEME_MARKET } from '@/trading/features/themes/types'

/** A name that has printed nothing this long past its due day has stopped trading. It is scored at
 *  its last close after the read, or flat at the read's own close when it never traded again,
 *  rather than dropped: dropping the names that stopped is how a record comes to look better than
 *  the list it was drawn from. */
const STOPPED_GRACE_DAYS = 30
/** A name whose bars cannot be read at all this long past its due day is gone from the source (a
 *  delisting), and is scored flat at the read's close; a shorter outage only waits. */
const UNREADABLE_GRACE_DAYS = 90

interface Exit {
  readonly at: TradingDay
  readonly close: number
}

interface OutcomeDeps {
  readonly store: Pick<ThemeStore, 'listDueOutcomes' | 'resolveOutcome'>
  readonly marketData: Pick<MarketDataService, 'bars'>
  today(now: number): TradingDay
}

interface Series {
  readonly bars: readonly Candle[]
  readonly index: readonly Candle[]
  readonly today: TradingDay
}

/** Close to close, from the read's session to the first session on or after its due day, for the
 *  name and for VN-Index on that same session. A row whose bars are not in yet stays pending and
 *  is asked again next tick; the cursor moves past it either way. */
export async function resolveDueOutcomes(
  deps: OutcomeDeps,
  options: OperationTickOptions<string>
): Promise<ThemeOutcomeBatch> {
  const today = deps.today(options.now)
  const page = await deps.store.listDueOutcomes({ ...options, today })
  const earliest = page.items.map((row) => row.entryDay).toSorted()[0]
  const index =
    earliest === undefined
      ? undefined
      : await readSeries(deps, options, {
          ticker: THEME_BENCHMARK,
          fromDay: earliest,
          toDay: today,
        })

  if (index === undefined || index.length === 0) {
    return toBatch(0, page)
  }

  let resolved = 0

  for (const row of page.items) {
    if (await resolveOne(deps, { row, index, today, options })) {
      resolved += 1
    }
  }

  return toBatch(resolved, page)
}

async function resolveOne(
  deps: OutcomeDeps,
  input: Omit<Series, 'bars'> & {
    readonly row: PendingOutcome
    readonly options: OperationTickOptions<string>
  }
): Promise<boolean> {
  const { row, options } = input

  assertNotAborted(options.signal)

  const bars = await readSeries(deps, options, {
    ticker: row.ticker,
    fromDay: row.entryDay,
    toDay: input.today,
  })
  const readable = bars ?? (isPastGrace(row, input.today, UNREADABLE_GRACE_DAYS) ? [] : undefined)
  const resolution =
    readable === undefined
      ? undefined
      : toResolution(row, { bars: readable, index: input.index, today: input.today })

  return (
    resolution !== undefined &&
    (await deps.store.resolveOutcome(
      row.id,
      { ...resolution, resolvedAt: options.now },
      options.signal
    ))
  )
}

interface SeriesRead {
  readonly ticker: Ticker
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Undefined when the source could not answer; an empty series is an answer. */
async function readSeries(
  deps: OutcomeDeps,
  options: OperationTickOptions<string>,
  read: SeriesRead
): Promise<readonly Candle[] | undefined> {
  const result = await deps.marketData.bars({
    ticker: read.ticker,
    market: THEME_MARKET,
    fromDay: read.fromDay,
    toDay: read.toDay,
    now: options.now,
    signal: options.signal,
  })

  return result.kind === 'available' ? result.value : undefined
}

/** The series' own close on the read's session while the bars still hold it, so a dividend the
 *  provider adjusted for cannot show as a loss; the stored close once they do not. */
function toResolution(
  row: PendingOutcome,
  series: Series
): Omit<ThemeOutcomeResolution, 'resolvedAt'> | undefined {
  const entryClose = closeOn(series.bars, row.entryDay) ?? row.entryClose
  const entryBenchmark = closeOn(series.index, row.entryDay) ?? row.entryBenchmark
  const exit = toExit(row, { ...series, entryClose })

  if (exit === undefined || entryClose <= 0 || entryBenchmark <= 0) {
    return undefined
  }

  // A name that never traded after its read is flat against an index held flat beside it.
  const exitBenchmark =
    exit.at === row.entryDay ? entryBenchmark : toIndexClose(series.index, exit.at)

  if (exitBenchmark === undefined) {
    return undefined
  }

  return {
    exitDay: exit.at,
    stockReturn: exit.close / entryClose - 1,
    benchmarkReturn: exitBenchmark / entryBenchmark - 1,
  }
}

function toExit(
  row: PendingOutcome,
  series: Series & { readonly entryClose: number }
): Exit | undefined {
  const due = series.bars.find((bar) => bar.at >= row.dueDay)

  if (due !== undefined) {
    return due
  }

  if (!isPastGrace(row, series.today, STOPPED_GRACE_DAYS)) {
    return undefined
  }

  return (
    series.bars.findLast((bar) => bar.at > row.entryDay) ?? {
      at: row.entryDay,
      close: series.entryClose,
    }
  )
}

/** VN-Index on the exit session, or on the last session before it when the series has printed past
 *  a hole there. A series that has not reached the exit session yet is waited for. */
function toIndexClose(index: readonly Candle[], day: TradingDay): number | undefined {
  const last = index.at(-1)

  if (last === undefined || last.at < day) {
    return undefined
  }

  return index.findLast((bar) => bar.at <= day)?.close
}

function isPastGrace(row: PendingOutcome, today: TradingDay, days: number): boolean {
  return toDayBefore(today, days) >= row.dueDay
}

function closeOn(bars: readonly Candle[], day: TradingDay): number | undefined {
  return bars.find((bar) => bar.at === day)?.close
}

function toBatch(resolved: number, page: Page<PendingOutcome, string>): ThemeOutcomeBatch {
  return { resolved, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) }
}

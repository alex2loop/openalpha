import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome } from '@/trading/sources/types'
import { tradingDay } from '@/trading/kernel/instrument'
import { DEFAULT_PAGE_SIZE, VNDIRECT_INDEX_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import { dropInvalid, pageRows, parseRow, toCandle } from '@/trading/sources/rows/normalization'

const INDEX_PATH = '/v4/vnmarket_prices'
const DAY_FIELD = 'date'

/** The feed's own spelling where it differs from the exchange's. Measured against `vietcap-chart`
 *  over 120 sessions: every close identical, so it is the same index under another name. */
const FEED_CODES: ReadonlyMap<string, string> = new Map([['VNMIDCAP', 'VNMID']])

const INDEX_ROW = z.object({
  code: z.string().min(1),
  date: z.string().min(1),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  // Matched plus put-through, the figure `vietcap-chart` publishes. `nmVolume` alone is the 17% short
  // series `vps` carries.
  accumulatedVol: z.number(),
})

interface IndexWindow {
  readonly code: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Indices only: the endpoint carries no futures contract (VN30F1M answers an empty page), so a
 *  future asked of it spends a request to say nothing. A symbol it does not carry answers an empty
 *  page, which the route reads as a settled miss. */
export function indexBarsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_INDEX_ID,
    kind: 'bars',
    http: options.http,
    covers: (context) => context.instrumentKind === 'index' && indexWindow(context) !== null,
    load: (context, signal) => loadIndexBars(options, context, signal),
  })
}

async function loadIndexBars(
  options: SourceAdapterOptions,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  const window = indexWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const outcome = await options.http.getJsonPages(
    {
      sourceId: VNDIRECT_INDEX_ID,
      path: INDEX_PATH,
      pageSize: DEFAULT_PAGE_SIZE,
      query: {
        sort: DAY_FIELD,
        q: `code:${window.code}~${DAY_FIELD}:gte:${window.fromDay}~${DAY_FIELD}:lte:${window.toDay}`,
        size: String(DEFAULT_PAGE_SIZE),
      },
      signal,
    },
    pageRows
  )

  return mapOutcome(outcome, (rows) => parsedSource(toCandles(rows, window.toDay)))
}

function indexWindow(context: SourceContext): IndexWindow | null {
  const { instrument, fromDay, toDay } = context

  if (instrument === undefined || fromDay === undefined || toDay === undefined) {
    return null
  }

  return { code: FEED_CODES.get(instrument.ticker) ?? instrument.ticker, fromDay, toDay }
}

/** The reply is newest-first whatever `sort` asks, and carries today's still-forming row — dated
 *  `2026:11:03` in some replies, `2026-11-03` in others — so the settled bound is applied here and a
 *  row whose day does not parse is dropped with the rest. A bars source owes its callers the oldest
 *  session first. */
function toCandles(rows: readonly unknown[], toDay: TradingDay): readonly Candle[] {
  return dropInvalid(rows, toIndexCandle)
    .filter((candle) => candle.at <= toDay)
    .sort((left, right) => left.at.localeCompare(right.at))
}

function toIndexCandle(raw: unknown): Candle {
  const row = parseRow(INDEX_ROW, raw, 'vndirect index')

  return toCandle({
    at: tradingDay(row.date),
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.accumulatedVol,
    // An index level is published, never restated.
    adjustment: 'raw',
  })
}

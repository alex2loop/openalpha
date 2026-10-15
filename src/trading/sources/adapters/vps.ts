// Source class: scraping-risky. `histdatafeed.vps.com.vn` is VPS Securities' own TradingView feed —
// undocumented and with no SLA, like `entrade` and `vietcap-chart`, so it can change or refuse
// traffic without notice. The endpoint is code-owned because it is a provider fact.
import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { MS_PER_SECOND } from '@/core/utils/time'
import { isLevelKind } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import {
  assertParallelColumns,
  dropInvalid,
  toCandle,
  utcDayOf,
  utcDayStartEpochSeconds,
} from '@/trading/sources/rows/normalization'

export const VPS_DEFAULT_ENDPOINT = 'https://histdatafeed.vps.com.vn/tradingview'

const VPS_ID = sourceId('vps')
const HISTORY_PATH = '/history'
const DAILY_RESOLUTION = '1D'

/** The feed's own spelling where it differs from the exchange's. Measured against `vietcap-chart`
 *  over 125 sessions: every close identical, so it is the same index under another name. */
const FEED_SYMBOLS: ReadonlyMap<string, string> = new Map([['VNMIDCAP', 'VNMID']])

// Parallel arrays, TradingView-style: one index is one session. A symbol the feed does not carry
// answers 200 with empty columns, which the route reads as a settled miss rather than an outage.
const HISTORY_RESPONSE = z.object({
  t: z.array(z.number()),
  o: z.array(z.number()),
  h: z.array(z.number()),
  l: z.array(z.number()),
  c: z.array(z.number()),
  v: z.array(z.number()),
})

type HistoryResponse = z.infer<typeof HISTORY_RESPONSE>

interface HistoryWindow {
  readonly symbol: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export function createVpsSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [barsSource(options)]
}

/** Levels only, for the reason `vietcap-chart` states: this series is unadjusted, and mixing one
 *  into vndirect's adjusted set would restate a split as a crash. Its volume is matched orders
 *  alone — measured 17% under vietcap's, which adds the put-through leg after the session — so it
 *  may never stand behind a provider whose turnover a factor reads. The ETF benchmark closes it is
 *  here for are identical to vietcap's over 707 sessions, and `isRestated` weighs the close. */
function barsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VPS_ID,
    kind: 'bars',
    http: options.http,
    covers: (context) => isLevelKind(context.instrumentKind) && historyWindow(context) !== null,
    load: (context, signal) => loadBars(options.http, context, signal),
  })
}

async function loadBars(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  const window = historyWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const outcome = await http.getJson(
    {
      sourceId: VPS_ID,
      path: HISTORY_PATH,
      query: {
        symbol: window.symbol,
        resolution: DAILY_RESOLUTION,
        from: String(utcDayStartEpochSeconds(window.fromDay)),
        to: String(utcDayStartEpochSeconds(window.toDay)),
      },
      signal,
    },
    (raw) => HISTORY_RESPONSE.parse(raw)
  )

  return mapOutcome(outcome, (payload) => parsedSource(toCandles(payload, window.toDay)))
}

function historyWindow(context: SourceContext): HistoryWindow | null {
  const { instrument, fromDay, toDay } = context

  if (instrument === undefined || fromDay === undefined || toDay === undefined) {
    return null
  }

  return { symbol: FEED_SYMBOLS.get(instrument.ticker) ?? instrument.ticker, fromDay, toDay }
}

function toCandles(payload: HistoryResponse, toDay: TradingDay): readonly Candle[] {
  assertParallelColumns(
    [payload.t, payload.o, payload.h, payload.l, payload.c, payload.v],
    'vps history'
  )

  const candles = dropInvalid([...payload.t.entries()], (entry) => toHistoryCandle(payload, entry))

  // The feed rounds `to` up to its own day: a window ending a second before a bar's stamp still
  // returns that bar, so the settled bound is applied here rather than trusted to the query.
  return candles.filter((candle) => candle.at <= toDay)
}

function toHistoryCandle(payload: HistoryResponse, entry: readonly [number, number]): Candle {
  const [index, at] = entry

  return toCandle({
    at: utcDayOf(at * MS_PER_SECOND),
    open: payload.o[index],
    high: payload.h[index],
    low: payload.l[index],
    close: payload.c[index],
    volume: payload.v[index],
    // An index level is published, never restated.
    adjustment: 'raw',
  })
}

// Source class: scraping-risky. The chart endpoint is internal and undocumented like the board
// reads that share this host, and it is the only provider that serves every HOSE index — entrade
// charts three of them and answers `invalid symbol` for the rest.
import { z } from 'zod'

import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { isLevelKind } from '@/trading/kernel/instrument'
import { shiftCalendarDay } from '@/trading/markets/calendar'
import { VIETCAP_CHART_ID } from '@/trading/sources/adapters/vietcap/client'
import { createSource, mapOutcome, parsedSource } from '@/trading/sources/define'
import {
  assertParallelColumns,
  dropInvalid,
  positive,
  toCandle,
  utcDayOf,
  utcDayStartEpochSeconds,
} from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const CHART_PATH = '/api/chart/OHLCChart/gap'
const DAILY_TIME_FRAME = 'ONE_DAY'
/** The finest frame this endpoint serves, so a live reading carries the instant its bar closed
 *  rather than the day it belongs to. The daily frame cannot answer that: its forming bar is dated
 *  to midnight, and a reading with no instant of its own cannot be aged. */
const INTRADAY_TIME_FRAME = 'ONE_MINUTE'

// Parallel arrays, oldest session first, one entry per session. `t` arrives as decimal strings
// stamped at exactly UTC midnight of the trading day — not at a session instant the way entrade's
// are, so the day is read in UTC and no zone conversion belongs here.
const CHART_SERIES = z.object({
  t: z.array(z.coerce.number()),
  o: z.array(z.number()),
  h: z.array(z.number()),
  l: z.array(z.number()),
  c: z.array(z.number()),
  v: z.array(z.number()),
})
const CHART_RESPONSE = z.array(CHART_SERIES)

type ChartSeries = z.infer<typeof CHART_SERIES>

interface QuoteWindow {
  readonly instrument: InstrumentRef
  readonly day: TradingDay
}

interface ChartWindow {
  readonly ticker: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Levels only. Shares and funds come from `vndirect`, whose series is adjusted, and mixing an
 *  unadjusted fallback into an adjusted one would restate a split as a crash; a contract carries no
 *  corporate action, so the rule that keeps them out does not reach it. */
export function chartBarsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_CHART_ID,
    kind: 'bars',
    http: options.http,
    covers: (context) => isLevelKind(context.instrumentKind) && chartWindow(context) !== null,
    load: (context, signal) => loadBars(options.http, context, signal),
  })
}

async function loadBars(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  const window = chartWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const outcome = await http.postJson(
    {
      sourceId: VIETCAP_CHART_ID,
      path: CHART_PATH,
      jsonBody: {
        timeFrame: DAILY_TIME_FRAME,
        symbols: [window.ticker],
        from: utcDayStartEpochSeconds(window.fromDay),
        // Inclusive of a bar stamped at exactly this second, and rounded up to the next day when
        // it is not, so the bound is the settled day's own midnight and never a second past it.
        to: utcDayStartEpochSeconds(window.toDay),
      },
      signal,
    },
    (raw) => CHART_RESPONSE.parse(raw)
  )

  return mapOutcome(outcome, (series) => parsedSource(toCandles(series, window.toDay)))
}

function chartWindow(context: SourceContext): ChartWindow | null {
  const { instrument, fromDay, toDay } = context

  if (instrument === undefined || fromDay === undefined || toDay === undefined) {
    return null
  }

  return { ticker: instrument.ticker, fromDay, toDay }
}

/** One symbol per request, so the reply holds one series; a symbol this provider does not chart
 *  comes back as an empty array, which the route reads as a settled miss rather than an outage. */
function toCandles(series: readonly ChartSeries[], toDay: TradingDay): readonly Candle[] {
  const [first] = series

  if (first === undefined) {
    return []
  }

  assertParallelColumns([first.t, first.o, first.h, first.l, first.c, first.v], 'vietcap chart')

  const candles = dropInvalid([...first.t.entries()], (entry) => toChartCandle(first, entry))

  // The daily series carries today's still-forming bar, which `to` admits whenever the settled day
  // is today. Every consumer of this kind reads bars as settled evidence.
  return candles.filter((candle) => candle.at <= toDay)
}

function toChartCandle(series: ChartSeries, entry: readonly [number, number]): Candle {
  const [index, at] = entry

  return toCandle({
    at: utcDayOf(at * MS_PER_SECOND),
    open: series.o[index],
    high: series.h[index],
    low: series.l[index],
    close: series.c[index],
    volume: series.v[index],
    // An index level is published, never restated.
    adjustment: 'raw',
  })
}

/** The live level, from the only VN provider whose intraday series keeps advancing through the
 *  session. `entrade` stands behind this one on the route and truncates its own newest bars for
 *  some windows — the reply is well-formed and hours behind, which no failover can see, so the
 *  market ages every reading it is handed rather than trusting the order alone.
 *
 *  Levels only, and only while the session can still be printing: outside it the stored close is
 *  the answer and costs no request. No `changePct` travels with it — `changeAgainstClose` owns the
 *  move, measured against the close the surface prints beside it. */
export function chartQuoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VIETCAP_CHART_ID,
    kind: 'quote',
    http: options.http,
    covers: (context) =>
      isLevelKind(context.instrumentKind) && context.live === true && quoteWindow(context) !== null,
    load: (context, signal) => loadQuote(options.http, context, signal),
    observedAt: (value) => value.observedAt,
  })
}

async function loadQuote(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<Quote>>> {
  const window = quoteWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const outcome = await http.postJson(
    {
      ...QUOTE_ATTEMPT_LIMITS,
      sourceId: VIETCAP_CHART_ID,
      path: CHART_PATH,
      jsonBody: {
        timeFrame: INTRADAY_TIME_FRAME,
        symbols: [window.instrument.ticker],
        from: utcDayStartEpochSeconds(window.day),
        // Inclusive of a bar stamped at exactly this second; the next session opens hours after it.
        to: utcDayStartEpochSeconds(shiftCalendarDay(window.day, 1)),
      },
      signal,
    },
    (raw) => CHART_RESPONSE.parse(raw)
  )

  if (outcome.kind !== 'ok') {
    return outcome
  }

  const [series] = outcome.value

  // One symbol per request, so a reply holding no series is a symbol this provider does not chart.
  // A settled miss rather than an outage, so the route falls through without opening the breaker.
  if (series === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  return mapOutcome(outcome, () => parsedSource(toQuote(series, window.instrument)))
}

function quoteWindow(context: SourceContext): QuoteWindow | null {
  const { instrument, toDay } = context

  return instrument === undefined || toDay === undefined ? null : { instrument, day: toDay }
}

/** The newest bar is the reading and the whole day's bars are its session, because the window asked
 *  for exactly one day. */
function toQuote(series: ChartSeries, instrument: InstrumentRef): Quote {
  assertParallelColumns(
    [series.t, series.o, series.h, series.l, series.c, series.v],
    'vietcap chart'
  )

  const last = series.t.length - 1
  const price = series.c[last]
  const at = series.t[last]

  if (price === undefined || at === undefined) {
    throw new ValidationError('vietcap chart returned no session to quote from')
  }

  const session = sessionSoFar(series)

  return {
    instrument,
    price: positive(price, 'close'),
    observedAt: at * MS_PER_SECOND,
    ...(session === undefined ? {} : { session }),
  }
}

/** Every bar in the reply belongs to the requested day, so the fold is the whole series. */
function sessionSoFar(series: ChartSeries): SessionSoFar | undefined {
  const first = series.t[0]

  if (first === undefined || series.h.length === 0 || series.l.length === 0) {
    return undefined
  }

  const volume = series.v.reduce((total, value) => total + value, 0)

  return {
    fromAt: first * MS_PER_SECOND,
    high: Math.max(...series.h),
    low: Math.min(...series.l),
    // A series carrying no volume for this instrument sums to zero, which is not a reading.
    ...(volume > 0 ? { volume } : {}),
  }
}

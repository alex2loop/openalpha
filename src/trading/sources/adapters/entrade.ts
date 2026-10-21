// Source class: scraping-risky. DNSE's `chart-api` is an internal, undocumented chart endpoint
// with no SLA — like `vndirect/`, it can change or refuse traffic without notice. The endpoint is
// code-owned rather than operator-typed because it is a provider fact, not a judgment call; a
// failing fetch degrades to a caveat through the normal failover path.
import { z } from 'zod'

import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { Candle, Quote, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { isLevelKind } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { median } from '@/trading/markets/timeseries'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  assertParallelColumns,
  dayChangePct,
  dayFromEpochSeconds,
  dropInvalid,
  positive,
  THOUSAND_VND_PER_UNIT,
  toCandle,
  toScaledPrice,
  utcDayStartEpochSeconds,
} from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

// The base path is part of the endpoint: the bare host answers 404 `no Route matched`.
export const ENTRADE_DEFAULT_ENDPOINT = 'https://services.entrade.com.vn/chart-api'

const ENTRADE_ID = sourceId('entrade')
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'
const DAILY_RESOLUTION = '1D'
// The daily series omits today until it settles, so only an intraday one can answer "now". The last
// bar of a settled VN session carries the official close, ATC included.
const INTRADAY_RESOLUTION = '15'
// Wide enough to still hold the previous session across a Tet break.
const QUOTE_LOOKBACK_DAYS = 14
const SECONDS_PER_DAY = 86_400

/** Sessions the newest daily level bar is weighed against. Short enough to sit inside one regime,
 *  long enough that a single quiet session does not set the bar. */
const LEVEL_VOLUME_REFERENCE_SESSIONS = 5
/** Below this share of that reference, the level series is still being written. The daily series is
 *  supposed to omit a session until it settles; neither the index nor the derivative endpoint does.
 *  Measured 2026-09-15, six hours after HOSE closed: VNINDEX answered with 76.5M shares against the
 *  previous session's 663.7M and a close of 1798.54 against the 1811.15 its own intraday series
 *  ended on, and VN30F1M with 42,466 contracts against 220,441. Both settle overnight, so dropping
 *  the bar costs one refresh, while keeping it publishes a close the market never printed.
 *
 *  Only a level is weighed this way, because its volume is a whole tape's turnover and holds a
 *  floor: over 2,282 stored index sessions the lowest genuine reading was 0.51 of its reference and
 *  over 242 stored VN30F1M sessions 0.46, against 0.12, 0.14 and 0.19 for the three truncated bars.
 *  One name's volume has no such floor — 13% of stored VN equity sessions fall under this share —
 *  so no volume test can speak for a single ticker. */
const FORMING_LEVEL_VOLUME_FRACTION = 0.25

// One series per instrument class, and the wrong one answers `invalid symbol` rather than data.
const SERIES_PATHS = Object.freeze({
  index: '/v2/ohlcs/index',
  future: '/v2/ohlcs/derivative',
} as const satisfies Partial<Record<InstrumentKind, string>>)
const CASH_SERIES_PATH = '/v2/ohlcs/stock'
// A name this provider does not chart answers 400. Counting that as an outage would open the
// breaker on the first open-ended fund and take the provider down with it.
const SYMBOL_MISS_STATUSES: readonly number[] = Object.freeze([400])

// Parallel arrays, Yahoo-style: one index is one session.
const OHLC = z.object({
  t: z.array(z.number()),
  o: z.array(z.number()),
  h: z.array(z.number()),
  l: z.array(z.number()),
  c: z.array(z.number()),
  v: z.array(z.number()),
})

export function createEntradeSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [barsSource(options), quoteSource(options)]
}

/** VN equities have no tick feed that ships with the product, so both answers come from the series
 *  endpoint `bars` already uses: the settled daily close, or the last intraday bar when the caller
 *  asked to be live. `observedAt` is stamped from whichever bar answered, so neither reads as a
 *  tick. */
function quoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: ENTRADE_ID,
    kind: 'quote',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    request: (context) => {
      if (context.instrument === undefined || context.toDay === undefined) {
        return null
      }

      const requestedDaySeconds = utcDayStartEpochSeconds(context.toDay)

      return {
        ...QUOTE_ATTEMPT_LIMITS,
        path: seriesPath(context.instrumentKind),
        businessMissStatuses: SYMBOL_MISS_STATUSES,
        query: {
          symbol: context.instrument.ticker,
          resolution: context.live === true ? INTRADAY_RESOLUTION : DAILY_RESOLUTION,
          from: String(requestedDaySeconds - QUOTE_LOOKBACK_DAYS * SECONDS_PER_DAY),
          to: String(requestedDaySeconds + SECONDS_PER_DAY),
        },
      }
    },
    parse: (raw, context) => parsedSource(toQuote(OHLC.parse(raw), context)),
    observedAt: (value) => value.observedAt,
  })
}

/** How many leading bars of this payload the provider has finished writing. Every bar but the
 *  newest, whenever that newest one is a daily level bar whose volume says the session is still
 *  being aggregated; every bar otherwise. The intraday series is never weighed — its bars carry a
 *  quarter-hour of turnover each, which has no floor to compare against. */
function settledBarCount(payload: z.infer<typeof OHLC>, context: SourceContext): number {
  const count = payload.t.length

  if (context.live === true || !isLevelKind(context.instrumentKind) || count === 0) {
    return count
  }

  return isFormingLevelBar(payload.v, count - 1) ? count - 1 : count
}

/** Whether the bar at `index` holds too little turnover to be a settled session, measured against
 *  the sessions before it. Over 2,282 stored index sessions the lowest genuine reading was 0.51 of
 *  its reference and over 242 stored VN30F1M sessions 0.46, against 0.12, 0.14 and 0.19 for the
 *  three truncated bars, so the two populations do not overlap anywhere near this fraction. */
function isFormingLevelBar(volumes: readonly number[], index: number): boolean {
  const volume = volumes[index]
  const reference = median(
    volumes.slice(Math.max(0, index - LEVEL_VOLUME_REFERENCE_SESSIONS), index)
  )

  return (
    volume !== undefined &&
    reference !== undefined &&
    volume < reference * FORMING_LEVEL_VOLUME_FRACTION
  )
}

function toQuote(payload: z.infer<typeof OHLC>, context: SourceContext): Quote {
  const unit = priceUnit(context.instrumentKind)
  const lastIndex = settledBarCount(payload, context) - 1
  const last = scale(payload.c[lastIndex], unit)
  const at = payload.t[lastIndex]

  if (context.instrument === undefined || last === undefined || at === undefined) {
    throw new ValidationError('entrade returned no session to quote from')
  }

  const changePct = dayChangePct(last, previousSessionClose(payload, at, unit))
  // Only the intraday resolution forms a session; the daily series' last bar is a settled one.
  const session = context.live === true ? sessionSoFar(payload, at, unit) : undefined

  return {
    instrument: context.instrument,
    price: positive(last, 'close'),
    ...(changePct === undefined ? {} : { changePct }),
    observedAt: at * MS_PER_SECOND,
    ...(session === undefined ? {} : { session }),
  }
}

/** The bars sharing the newest bar's ICT day, folded into what the series has recorded today. */
function sessionSoFar(
  payload: z.infer<typeof OHLC>,
  lastAt: number,
  unit: number
): SessionSoFar | undefined {
  const day = dayFromEpochSeconds(lastAt, VN_TIMEZONE)
  const bars = payload.t.flatMap((at, index) =>
    dayFromEpochSeconds(at, VN_TIMEZONE) === day ? [index] : []
  )
  const first = payload.t[bars[0] ?? -1]
  const highs = bars.flatMap((index) => scale(payload.h[index], unit) ?? [])
  const lows = bars.flatMap((index) => scale(payload.l[index], unit) ?? [])

  if (first === undefined || highs.length === 0 || lows.length === 0) {
    return undefined
  }

  const volume = bars.reduce((total, index) => total + (payload.v[index] ?? 0), 0)

  return {
    fromAt: first * MS_PER_SECOND,
    high: Math.max(...highs),
    low: Math.min(...lows),
    // A series carrying no volume for this instrument sums to zero, which is not a reading.
    ...(volume > 0 ? { volume } : {}),
  }
}

/** On the intraday series the previous bar is fifteen minutes back, not a session. Bars carry no
 *  session marker, so the boundary is the ICT calendar day. */
function previousSessionClose(
  payload: z.infer<typeof OHLC>,
  lastAt: number,
  unit: number
): number | undefined {
  const lastDay = dayFromEpochSeconds(lastAt, VN_TIMEZONE)

  for (let index = payload.t.length - 2; index >= 0; index -= 1) {
    const at = payload.t[index]

    if (at !== undefined && dayFromEpochSeconds(at, VN_TIMEZONE) !== lastDay) {
      return scale(payload.c[index], unit)
    }
  }

  return undefined
}

function barsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: ENTRADE_ID,
    kind: 'bars',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    request: (context) =>
      context.instrument && context.fromDay && context.toDay
        ? {
            path: seriesPath(context.instrumentKind),
            businessMissStatuses: SYMBOL_MISS_STATUSES,
            query: {
              symbol: context.instrument.ticker,
              resolution: DAILY_RESOLUTION,
              from: String(utcDayStartEpochSeconds(context.fromDay)),
              // The endpoint's range is inclusive of `from` and exclusive of `to`.
              to: String(utcDayStartEpochSeconds(context.toDay) + SECONDS_PER_DAY),
            },
          }
        : null,
    parse: (raw, context) => parsedSource(toCandles(OHLC.parse(raw), context)),
  })
}

function toCandles(payload: z.infer<typeof OHLC>, context: SourceContext): readonly Candle[] {
  assertParallelColumns(
    [payload.t, payload.o, payload.h, payload.l, payload.c, payload.v],
    'entrade ohlc'
  )

  const settled = settledBarCount(payload, context)

  if (hasFrozenLevelBar(payload, context, settled)) {
    return []
  }

  const unit = priceUnit(context.instrumentKind)
  const candles = dropInvalid(
    payload.t.slice(0, settled).map((_, index) => index),
    (index) =>
      // Entrade publishes no adjusted set, so `raw`.
      toCandle({
        at: dayFromEpochSeconds(payload.t[index], VN_TIMEZONE),
        open: scale(payload.o[index], unit),
        high: scale(payload.h[index], unit),
        low: scale(payload.l[index], unit),
        close: scale(payload.c[index], unit),
        volume: payload.v[index],
        adjustment: 'raw',
      })
  )

  return coversSettledSession(candles, context) ? candles : []
}

/** Whether any settled bar in a level series is still an early-session snapshot. The endpoint
 *  freezes such a bar and never corrects it, so one that was forming while it was newest is still
 *  frozen once later sessions land on top of it — 2026-09-16, a day after the close, VNINDEX read
 *  1798.54 on 76.5M shares against the 1811.15 on 642.5M the tape printed, with a correct bar
 *  beside it. Weighing only the newest caught it for one day and served it wholesale after that.
 *  The whole series is refused rather than the bar dropped: a hole inside a window reads as a
 *  session the market did not trade, while refusing reaches `vietcap-chart`. */
function hasFrozenLevelBar(
  payload: z.infer<typeof OHLC>,
  context: SourceContext,
  settled: number
): boolean {
  if (!isLevelKind(context.instrumentKind)) {
    return false
  }

  return payload.v.slice(0, settled).some((_, index) => isFormingLevelBar(payload.v, index))
}

/** A level series that stops short of the session the caller asked for cannot answer the request.
 *  The endpoint freezes the newest index and derivative bar at an early-session snapshot and never
 *  corrects it — 2026-09-16, a day after the close, VNINDEX still read 1798.54 against 1811.15 — so
 *  answering short settles the route and leaves a hole no refresh fills, while answering with
 *  nothing reaches `vietcap-chart`. A cash series is never weighed and always covers what it got. */
function coversSettledSession(candles: readonly Candle[], context: SourceContext): boolean {
  const { toDay } = context

  if (toDay === undefined || !isLevelKind(context.instrumentKind)) {
    return true
  }

  const newest = candles[candles.length - 1]

  return newest !== undefined && newest.at >= toDay
}

function seriesPath(kind: InstrumentKind | undefined): string {
  return isLevelKind(kind) ? SERIES_PATHS[kind] : CASH_SERIES_PATH
}

/** Only cash prices are quoted in thousands of VND per share. Scaling a level would report VN30F1M
 *  at 1,846,500. */
function priceUnit(kind: InstrumentKind | undefined): number {
  return isLevelKind(kind) ? 1 : THOUSAND_VND_PER_UNIT
}

function scale(value: number | undefined, unit: number): number | undefined {
  return value === undefined ? undefined : toScaledPrice(value, unit)
}

import { z } from 'zod'

import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import {
  BINANCE_ID,
  SYMBOL_MISS_STATUSES,
  TRADING_STATUS,
} from '@/trading/sources/adapters/binance/client'
import { spotProxyCaveats, spotSymbol } from '@/trading/sources/adapters/binance/symbol'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  finite,
  klineLimit,
  positive,
  toCandle,
  utcDayEndEpochMs,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'
import { withSettledBars } from '@/trading/sources/settled-bars'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const DAILY_INTERVAL = '1d'
const MAXIMUM_KLINES = 1000

/** Positions 0-5 are open time and OHLCV; 9 is the taker-buy base volume. The two skipped slots are
 *  close time, quote volume and trade count, none of which anything here reads. */
const KLINES = z.array(
  z
    .tuple([
      z.number(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.unknown(),
      z.unknown(),
      z.unknown(),
      z.string(),
    ])
    .rest(z.unknown())
)

/** The rolling 24 h window for one symbol. `closeTime` is the window's end, which is the instant
 *  the quote was taken. */
const TICKER_24H = z.object({
  lastPrice: z.string().min(1),
  priceChangePercent: z.string().min(1),
  closeTime: z.number(),
})

export function binanceBarsSource(options: SourceAdapterOptions): RegisteredSource {
  return withSettledBars(
    createSource({
      id: BINANCE_ID,
      kind: 'bars',
      format: 'json',
      http: options.http,
      covers: (context) => context.instrument !== undefined,
      request: (context) =>
        context.instrument === undefined
          ? null
          : {
              path: '/api/v3/klines',
              query: {
                symbol: spotSymbol(context.instrument.ticker),
                interval: DAILY_INTERVAL,
                limit: String(klineLimit(context, MAXIMUM_KLINES)),
                ...(context.fromDay
                  ? { startTime: String(utcDayStartEpochMs(context.fromDay)) }
                  : {}),
                ...(context.toDay ? { endTime: String(utcDayEndEpochMs(context.toDay)) } : {}),
              },
              businessMissStatuses: SYMBOL_MISS_STATUSES,
            },
      parse: (raw, context) => parsedSource(toCandles(raw), spotProxyCaveats(context)),
    })
  )
}

export function binanceQuoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: BINANCE_ID,
    kind: 'quote',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    request: (context) =>
      context.instrument === undefined
        ? null
        : {
            ...QUOTE_ATTEMPT_LIMITS,
            path: '/api/v3/ticker/24hr',
            query: { symbol: spotSymbol(context.instrument.ticker), symbolStatus: TRADING_STATUS },
            businessMissStatuses: SYMBOL_MISS_STATUSES,
          },
    parse: (raw, context) => parsedSource(toQuote(raw, context), spotProxyCaveats(context)),
    observedAt: (value) => value.observedAt,
  })
}

/** No `session`: the 24 h window is rolling, not a session, and an alert reading its high as a
 *  session high would fire on a move that happened before the alert was set. */
function toQuote(raw: unknown, context: SourceContext): Quote {
  if (!context.instrument) {
    throw new ValidationError('binance quote requires an instrument')
  }

  const row = TICKER_24H.parse(raw)

  return {
    instrument: context.instrument,
    price: positive(Number(row.lastPrice), 'lastPrice'),
    changePct: finite(Number(row.priceChangePercent), 'priceChangePercent'),
    observedAt: finite(row.closeTime, 'closeTime'),
  }
}

// Open time, not close time: a daily bar belongs to the UTC day it opened on, and Binance's close
// time is one millisecond before the next midnight.
function toCandles(raw: unknown): readonly Candle[] {
  return dropInvalid(KLINES.parse(raw), (row) =>
    toCandle({
      at: dayFromEpochSeconds(row[0] / MS_PER_SECOND, 'UTC'),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      takerBuyVolume: Number(row[9]),
      adjustment: 'raw',
    })
  )
}

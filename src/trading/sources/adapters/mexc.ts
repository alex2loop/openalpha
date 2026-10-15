// Source class: free and keyless. Third in the crypto bars order and second in the quote order: it
// lists roughly twice the spot universe Binance and Bybit carry between them, so it answers only
// for the names those two decline.
import { z } from 'zod'

import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  finite,
  klineLimit,
  PERCENT_PER_UNIT,
  positive,
  toCandle,
  utcDayEndEpochMs,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'
import { withSettledBars } from '@/trading/sources/settled-bars'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const MEXC_DEFAULT_ENDPOINT = 'https://api.mexc.com'

const MEXC_ID = sourceId('mexc')

/** Every pair this adapter reads is USDT-quoted, so a bar is already a USD-equivalent price. */
const QUOTE_ASSET = 'USDT'
const DAILY_INTERVAL = '1d'
/** Measured, not documented: the endpoint caps a page at 500 rows however high `limit` goes, while
 *  the docs say 1 000. The figure that bounds a window has to be the one the host honours. */
const MAXIMUM_KLINES = 500
/** An unlisted symbol answers HTTP 400 with code -1121. The core seam discards non-2xx bodies, so
 *  the status is the only signal available, and a name this venue lacks must not open the breaker
 *  for every other symbol. */
const SYMBOL_MISS_STATUSES: readonly number[] = Object.freeze([400])

/** Positions 0-5 are open time and OHLCV. Close time and quote volume follow and nothing here reads
 *  them; there is no aggressor split at all, so every bar this source writes leaves
 *  `takerBuyVolume` absent. */
const KLINES = z.array(
  z
    .tuple([z.number(), z.string(), z.string(), z.string(), z.string(), z.string()])
    .rest(z.unknown())
)

/** The rolling 24 h window for one symbol. `closeTime` is the window's end, which is the instant the
 *  quote was taken. Unlike the Binance-shaped endpoint it copies, `priceChangePercent` carries a
 *  fraction rather than a percent — measured 0,0048 against a true 0,49% move. */
const TICKER_24H = z.object({
  lastPrice: z.string().min(1),
  priceChangePercent: z.string().min(1),
  closeTime: z.number(),
})

export function createMexcSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [barsSource(options), quoteSource(options)]
}

function barsSource(options: SourceAdapterOptions): RegisteredSource {
  return withSettledBars(
    createSource({
      id: MEXC_ID,
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
                symbol: `${context.instrument.ticker}${QUOTE_ASSET}`,
                interval: DAILY_INTERVAL,
                limit: String(klineLimit(context, MAXIMUM_KLINES)),
                ...(context.fromDay
                  ? { startTime: String(utcDayStartEpochMs(context.fromDay)) }
                  : {}),
                ...(context.toDay ? { endTime: String(utcDayEndEpochMs(context.toDay)) } : {}),
              },
              businessMissStatuses: SYMBOL_MISS_STATUSES,
            },
      parse: (raw) => parsedSource(toCandles(raw)),
    })
  )
}

function quoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: MEXC_ID,
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
            query: { symbol: `${context.instrument.ticker}${QUOTE_ASSET}` },
            businessMissStatuses: SYMBOL_MISS_STATUSES,
          },
    parse: (raw, context) => parsedSource(toQuote(raw, context)),
    observedAt: (value) => value.observedAt,
  })
}

function toQuote(raw: unknown, context: SourceContext): Quote {
  if (!context.instrument) {
    throw new ValidationError('mexc quote requires an instrument')
  }

  const row = TICKER_24H.parse(raw)

  return {
    instrument: context.instrument,
    price: positive(Number(row.lastPrice), 'lastPrice'),
    changePct: finite(Number(row.priceChangePercent), 'priceChangePercent') * PERCENT_PER_UNIT,
    observedAt: finite(row.closeTime, 'closeTime'),
  }
}

// Open time, not close time: a daily bar belongs to the UTC day it opened on, and the close time is
// one millisecond before the next midnight.
function toCandles(raw: unknown): readonly Candle[] {
  return dropInvalid(KLINES.parse(raw), (row) =>
    toCandle({
      at: dayFromEpochSeconds(row[0] / MS_PER_SECOND, 'UTC'),
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
      adjustment: 'raw',
    })
  )
}

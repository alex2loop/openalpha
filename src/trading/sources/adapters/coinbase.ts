// Source class: free and keyless, and a venue rather than an aggregator - it quotes the coin-fiat
// pair it actually trades. It leads the fx route for the coins it lists, so the peg a crypto book is
// valued through does not rest on a metered index alone. It also prices a coin in USDT, as the other
// crypto venues do, by converting its dollar pair through USDT's own: the last provider a US
// operator can reach when the others refuse their address.
import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { CandleRow } from '@/trading/sources/adapters/coinbase-usdt'
import type { CryptoFxReading, CryptoFxSpec } from '@/trading/sources/adapters/crypto-fx'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceFetchOutcome, SourceHttp } from '@/trading/sources/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { sourceId } from '@/trading/kernel/source/source-id'
import { toUsdtCandles, toUsdtQuote } from '@/trading/sources/adapters/coinbase-usdt'
import { boardObservedAt } from '@/trading/sources/adapters/crypto-board'
import { createCryptoFx } from '@/trading/sources/adapters/crypto-fx'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  klineLimit,
  utcDayEndEpochMs,
  utcDayOf,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'
import { withSettledBars } from '@/trading/sources/settled-bars'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const COINBASE_DEFAULT_ENDPOINT = 'https://api.exchange.coinbase.com'

const COINBASE_SOURCE = sourceId('coinbase')

/** The coins this venue prices against a fiat. It spells a coin on the wire exactly as the pair's
 *  base is spelled, so there is no mapping to hold here — only which coins are covered. */
const FX_COINS: ReadonlySet<string> = new Set(['USDT'])
/** A product the venue does not list answers 404. That is a property of the request — this venue
 *  trades some pairs and not others — rather than a provider that failed. */
const PRODUCT_MISS_STATUSES: readonly number[] = Object.freeze([404])
const PEG = 'USDT'
const FIAT = 'USD'
const DAILY_GRANULARITY = '86400'
/** The venue's page ceiling for candles; a longer window is asked in consecutive chunks. */
const MAXIMUM_CANDLES = 300

/** `price` is the last trade and `time` is when it printed, both as strings. */
const TICKER = z.object({ price: z.string().min(1), time: z.string().min(1) })
const CANDLES = z.array(
  z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()])
)

export function createCoinbaseSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [createCryptoFx(options, FX), usdtQuoteSource(options), usdtBarsSource(options)]
}

const FX: CryptoFxSpec = {
  id: COINBASE_SOURCE,
  coinId: (base) => (FX_COINS.has(base) ? base : undefined),
  request: (input) => ({
    ...QUOTE_ATTEMPT_LIMITS,
    path: `/products/${input.coinId}-${input.fiat}/ticker`,
    businessMissStatuses: PRODUCT_MISS_STATUSES,
  }),
  parse: (raw) => toFxReading(TICKER.parse(raw)),
}

function toFxReading(row: z.infer<typeof TICKER>): CryptoFxReading {
  return { rate: Number(row.price), ...boardObservedAt(row.time) }
}

function usdtQuoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: COINBASE_SOURCE,
    kind: 'quote',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    load: async (context, signal) => {
      const { instrument } = context

      if (instrument === undefined) {
        return { kind: 'error', code: 'source.symbol-not-found' }
      }

      const [coin, peg] = await Promise.all([
        readTicker(options.http, instrument.ticker, signal),
        readTicker(options.http, PEG, signal),
      ])

      // A coin with no peg is never given a dollar price: the book would value it in the wrong unit.
      if (coin.kind === 'error') {
        return coin
      }

      if (peg.kind === 'error') {
        return peg
      }

      const { price, observedAt } = toUsdtQuote(
        { ...coin.value, observedAt: coin.value.observedAt ?? coin.fetchedAt },
        { ...peg.value, observedAt: peg.value.observedAt ?? peg.fetchedAt }
      )

      return {
        ...coin,
        value: parsedSource<Quote>({ instrument, price, observedAt }),
      }
    },
    observedAt: (value) => value.observedAt,
  })
}

async function readTicker(
  http: SourceHttp,
  coin: string,
  signal: AbortSignal
): Promise<SourceFetchOutcome<{ readonly price: number; readonly observedAt?: number }>> {
  return http.getJson(
    {
      ...QUOTE_ATTEMPT_LIMITS,
      sourceId: COINBASE_SOURCE,
      path: `/products/${coin}-${FIAT}/ticker`,
      businessMissStatuses: PRODUCT_MISS_STATUSES,
      signal,
    },
    (raw) => {
      const row = TICKER.parse(raw)

      return { price: Number(row.price), ...boardObservedAt(row.time) }
    }
  )
}

function usdtBarsSource(options: SourceAdapterOptions): RegisteredSource {
  return withSettledBars(
    createSource({
      id: COINBASE_SOURCE,
      kind: 'bars',
      http: options.http,
      covers: (context) => context.instrument !== undefined,
      load: (context, signal) => loadBars(options.http, context, signal),
    })
  )
}

async function loadBars(
  http: SourceHttp,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  const { instrument } = context

  if (instrument === undefined) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const toDay = context.toDay ?? utcDayOf(Date.now())
  const fromDay =
    context.fromDay ??
    utcDayOf(utcDayStartEpochMs(toDay) - klineLimit(context, MAXIMUM_CANDLES) * MS_PER_DAY)
  const coin = await readCandles(http, { coin: instrument.ticker, fromDay, toDay }, signal)
  const peg = await readCandles(http, { coin: PEG, fromDay, toDay }, signal)

  if (coin.kind === 'error') {
    return coin
  }

  if (peg.kind === 'error') {
    return peg
  }

  return { ...coin, value: parsedSource(toUsdtCandles(coin.value, peg.value)) }
}

interface CandleWindow {
  readonly coin: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

/** Consecutive chunks of at most `MAXIMUM_CANDLES` days; one failed chunk fails the whole read,
 *  because the series is written whole over its window. */
async function readCandles(
  http: SourceHttp,
  window: CandleWindow,
  signal: AbortSignal
): Promise<SourceFetchOutcome<readonly CandleRow[]>> {
  const rows: CandleRow[] = []
  let fetchedAt = 0
  let start = utcDayStartEpochMs(window.fromDay)
  const finish = utcDayEndEpochMs(window.toDay)

  while (start <= finish) {
    const end = Math.min(start + MAXIMUM_CANDLES * MS_PER_DAY - 1, finish)
    const chunk = await http.getJson(
      {
        sourceId: COINBASE_SOURCE,
        path: `/products/${window.coin}-${FIAT}/candles`,
        query: {
          granularity: DAILY_GRANULARITY,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
        },
        businessMissStatuses: PRODUCT_MISS_STATUSES,
        signal,
      },
      (raw) => CANDLES.parse(raw)
    )

    if (chunk.kind === 'error') {
      return chunk
    }

    rows.push(...chunk.value)
    fetchedAt = chunk.fetchedAt
    start = end + 1
  }

  return { kind: 'ok', value: rows, fetchedAt }
}

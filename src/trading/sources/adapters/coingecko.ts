// Source class: key optional. A Demo key buys 10,000 calls a month; keyless access is a band shared
// per IP. Backs the market-cap board for its rank and seven-day change, prices a settlement coin in
// a fiat (one rate read a run), and serves the dollar-dong history from USDT's price in dong: one
// request a window where the bank's feed costs one a weekday.
import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { FxRatePoint } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { BoardRow, BoardSpec } from '@/trading/sources/adapters/crypto-board'
import type { CryptoFxReading, CryptoFxSpec } from '@/trading/sources/adapters/crypto-fx'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { SourceRequest } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import { currencyCode, fxPair } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { boardObservedAt, createCryptoBoard } from '@/trading/sources/adapters/crypto-board'
import { createCryptoFx } from '@/trading/sources/adapters/crypto-fx'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  fromCodeTable,
  positive,
  utcDayEndEpochSeconds,
  utcDayOf,
  utcDayStartEpochMs,
  utcDayStartEpochSeconds,
} from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

export const COINGECKO_DEFAULT_ENDPOINT = 'https://api.coingecko.com/api/v3'

const COINGECKO_ID = 'coingecko'
const COINGECKO_SOURCE = sourceId(COINGECKO_ID)
/** Sent when a key is set; without one the keyless band answers, shared per IP. */
const CREDENTIAL = { kind: 'header', name: 'x-cg-demo-api-key', optional: true } as const
const VS_CURRENCY = 'usd'
const DEFAULT_ROW_COUNT = 100
/** The most one page returns, and the window past which a symbol claims no coin. */
const MAXIMUM_PER_PAGE = 250
/** The one change window the sweep asks for beyond the day: what the screen chooses its board on. */
const SWEEP_CHANGE_WINDOW = '7d'
const SIMPLE_PRICE_PATH = '/simple/price'
const TETHER_ID = 'tether'
/** The coins this source can price in a fiat, by the id CoinGecko knows them under. */
const FX_COIN_IDS: Readonly<Record<string, string>> = Object.freeze({ USDT: TETHER_ID })
/** The one dated pair read through a coin: USDT stands for the dollar, priced in dong. */
const FX_HISTORY_FROM = currencyCode('USD')
const FX_HISTORY_TO = currencyCode('VND')
const FX_HISTORY_PAIR = fxPair(FX_HISTORY_FROM, FX_HISTORY_TO)
const FX_HISTORY_FIAT = FX_HISTORY_TO.toLowerCase()
const MARKET_CHART_RANGE_PATH = `/coins/${TETHER_ID}/market_chart/range`
/** The longest window the keyless band reads in one request. */
const MAXIMUM_FX_HISTORY_DAYS = 365
const TOKEN_FX_PROXY_CAVEAT: Caveat = {
  code: 'source.token-fx-proxy',
  detail: { source: COINGECKO_ID },
}
/** The one key in a priced row that is not a price. */
const LAST_UPDATED_KEY = 'last_updated_at'

const MARKETS = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    symbol: z.string().min(1),
    current_price: z.number().nullable(),
    market_cap: z.number().nullable(),
    total_volume: z.number().nullable(),
    market_cap_rank: z.number().nullable(),
    price_change_percentage_24h: z.number().nullish(),
    price_change_percentage_7d_in_currency: z.number().nullish(),
    last_updated: z.string().min(1),
  })
)

/** Milliseconds since the epoch and the price, one pair a day when asked for a daily interval. */
const MARKET_CHART = z.object({ prices: z.array(z.tuple([z.number(), z.number()])) })

/** Prices keyed by coin id, then by the lowercase fiat code the request asked for, with the stamp
 *  sharing that inner object. */
const SIMPLE_PRICE = z.record(z.string(), z.record(z.string(), z.number()))

interface FxHistoryWindow {
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

export function createCoinGeckoSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createCryptoBoard(options, BOARD).marketCap,
    createCryptoFx(options, FX),
    fxHistorySource(options),
  ]
}

const BOARD: BoardSpec = {
  id: COINGECKO_ID,
  request: marketsRequest,
  parse: (raw) => MARKETS.parse(raw).map(toBoardRow),
  resolutionRankLimit: MAXIMUM_PER_PAGE,
  defaultRowCount: DEFAULT_ROW_COUNT,
  lookup: symbolRequest,
}

function toBoardRow(row: z.infer<typeof MARKETS>[number]): BoardRow {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    rank: row.market_cap_rank,
    priceUsd: row.current_price,
    marketCapUsd: row.market_cap,
    volumeUsd: row.total_volume,
    changePct: row.price_change_percentage_24h ?? null,
    change7dPct: row.price_change_percentage_7d_in_currency ?? null,
    ...boardObservedAt(row.last_updated),
  }
}

function marketsRequest(signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINGECKO_SOURCE,
    path: '/coins/markets',
    query: {
      vs_currency: VS_CURRENCY,
      order: 'market_cap_desc',
      per_page: String(MAXIMUM_PER_PAGE),
      page: '1',
      price_change_percentage: SWEEP_CHANGE_WINDOW,
    },
    credential: CREDENTIAL,
    signal,
  }
}

/** One named symbol, for a coin ranked past the page the board reads. Same endpoint and same row
 *  shape as the board, so a coin outside the listing is quoted exactly as one inside it. */
function symbolRequest(symbol: string, signal: AbortSignal): SourceRequest {
  return {
    sourceId: COINGECKO_SOURCE,
    path: '/coins/markets',
    query: {
      vs_currency: VS_CURRENCY,
      symbols: symbol.toLowerCase(),
      price_change_percentage: SWEEP_CHANGE_WINDOW,
    },
    credential: CREDENTIAL,
    signal,
  }
}

const FX: CryptoFxSpec = {
  id: COINGECKO_SOURCE,
  coinId: (base) => fromCodeTable(FX_COIN_IDS, base),
  request: (input) => ({
    path: SIMPLE_PRICE_PATH,
    query: {
      ids: input.coinId,
      vs_currencies: input.fiat.toLowerCase(),
      include_last_updated_at: 'true',
    },
    credential: CREDENTIAL,
    ...QUOTE_ATTEMPT_LIMITS,
  }),
  parse: (raw) => toFxReading(SIMPLE_PRICE.parse(raw)),
}

/** The request names one coin and one fiat, so the payload carries one row holding one price.
 *  Reading both positionally is what lets the shared spec's `parse` stay context-free; a payload
 *  answering anything else is a bug rather than a rate. */
function toFxReading(payload: z.infer<typeof SIMPLE_PRICE>): CryptoFxReading {
  const [row, ...otherCoins] = Object.values(payload)

  if (row === undefined || otherCoins.length > 0) {
    throw new ValidationError('coingecko fx did not answer exactly one coin')
  }

  const [priced, ...otherRates] = Object.entries(row).filter(([key]) => key !== LAST_UPDATED_KEY)

  if (priced === undefined || otherRates.length > 0) {
    throw new ValidationError('coingecko fx did not answer exactly one rate')
  }

  const stamp = row[LAST_UPDATED_KEY]

  return {
    rate: priced[1],
    ...(stamp === undefined ? {} : { observedAt: stamp * MS_PER_SECOND }),
  }
}

/** Behind `yahoo`, ahead of the bank: a window costs one request however long it is. A point is
 *  stamped 00:00 UTC, 07:00 in Vietnam, so the rate dated D is known before D's counters open and
 *  prices D or any later day within the lag rule, never an earlier one. */
function fxHistorySource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: COINGECKO_SOURCE,
    kind: 'fxHistory',
    format: 'json',
    http: options.http,
    covers: (context) => fxHistoryWindow(context) !== null,
    request: (context) => {
      const window = fxHistoryWindow(context)

      return window === null ? null : fxHistoryRequest(window)
    },
    parse: (raw, context) => toFxHistory(raw, context),
  })
}

function fxHistoryWindow(context: SourceContext): FxHistoryWindow | null {
  const { ticker, fromDay, toDay } = context

  if (ticker !== FX_HISTORY_PAIR || fromDay === undefined || toDay === undefined) {
    return null
  }

  const days = (utcDayStartEpochMs(toDay) - utcDayStartEpochMs(fromDay)) / MS_PER_DAY

  return days >= 0 && days <= MAXIMUM_FX_HISTORY_DAYS ? { fromDay, toDay } : null
}

function fxHistoryRequest(window: FxHistoryWindow): Omit<SourceRequest, 'sourceId' | 'signal'> {
  return {
    path: MARKET_CHART_RANGE_PATH,
    query: {
      vs_currency: FX_HISTORY_FIAT,
      from: String(utcDayStartEpochSeconds(window.fromDay)),
      to: String(utcDayEndEpochSeconds(window.toDay)),
      interval: 'daily',
    },
    credential: CREDENTIAL,
  }
}

/** One point a UTC day: the first, so a reading of the day in progress appended after its midnight
 *  point never replaces it. */
function toFxHistory(raw: unknown, context: SourceContext): ParsedSource<readonly FxRatePoint[]> {
  const window = fxHistoryWindow(context)

  if (window === null) {
    throw new ValidationError('coingecko fx history needs the dollar-dong pair and a window')
  }

  const priced = dropInvalid(MARKET_CHART.parse(raw).prices, ([at, price]) => ({
    day: utcDayOf(at),
    rate: positive(price, 'price'),
  }))
  const points = new Map<TradingDay, FxRatePoint>()

  for (const point of priced) {
    if (point.day >= window.fromDay && point.day <= window.toDay && !points.has(point.day)) {
      points.set(point.day, point)
    }
  }

  return parsedSource([...points.values()], [TOKEN_FX_PROXY_CAVEAT])
}

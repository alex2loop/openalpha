// Source class: scraping-risky. Yahoo's chart endpoint is unofficial and actively blocks
// scrapers; never let a global depend on it.
import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle, FxQuote, FxRatePoint, Quote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'
import { currencyCode } from '@/trading/kernel/instrument'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dayFromEpochSeconds,
  dropInvalid,
  fromCodeTable,
  isUsableTimezone,
  PERCENT_PER_UNIT,
  positive,
  toCandle,
  utcDayEndEpochSeconds,
  utcDayStartEpochSeconds,
} from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

const YAHOO_ID = sourceId('yahoo')
export const YAHOO_DEFAULT_ENDPOINT = 'https://query1.finance.yahoo.com'

/** CME month codes, indexed by calendar month. */
const FUTURES_MONTH_CODES = 'FGHJKMNQUVXZ'
const COMEX_SUFFIX = '.CMX'
const FUTURES_ROOT_SUFFIX = '=F'

/** Yahoo lists neither metal at its spot symbol, and the undated root charts the spot month running
 *  into expiry while answering a quote from the active one — 73 gold lots against December's
 *  201,300 on 2026-09-11. The delivery months each metal actually trades in size are the research
 *  decision that keeps one instrument on both legs; measure volume before changing either tuple. */
const METAL_DELIVERY_MONTHS: Readonly<Record<string, { root: string; months: readonly number[] }>> =
  Object.freeze({
    XAUUSD: { root: 'GC', months: [2, 4, 6, 8, 12] },
    XAGUSD: { root: 'SI', months: [3, 5, 7, 9, 12] },
  })

/** Yahoo's crypto namespace. Unlike the bare metals tickers the suffix is self-validating — an
 *  unlisted pair answers 404 rather than an unrelated listing — so it needs no table. */
const USD_PAIR_SUFFIX = '-USD'
/** For a coin pair only: a 404 says the coin is not listed here. A metals ticker resolves through a
 *  total table, so its 404 is a mapping that broke and must read as a failure. */
const COIN_PAIR_MISS_STATUSES = Object.freeze([404])
const CRYPTO_LISTING_TYPES: readonly string[] = Object.freeze(['CRYPTOCURRENCY'])
// Measured 2026-09-15: `GC=F` and `GCZ26.CMX` both answer FUTURE, as do `SI=F` and `SIZ26.CMX`, so
// the root and the dated contract are one expectation rather than two.
const FUTURES_LISTING_TYPES: readonly string[] = Object.freeze(['FUTURE'])

/** The substitution has one owner, so it declares itself here rather than leaving every reader to
 *  discover that "world gold" is a dated contract carrying about a percent of cost of carry. */
const FUTURES_PROXY_CAVEAT: Caveat = {
  code: 'source.futures-proxy',
  detail: { source: YAHOO_ID },
}

const CURRENCY_PAIR_RE = /^([A-Z]{3})([A-Z]{3})$/
// A four-letter code is a coin (`USDT`), listed against the dollar as `USDT-USD`.
const COIN_USD_PAIR_RE = /^([A-Z]{4})USD$/
const DAILY_INTERVAL = '1d'
/** One session, so the response's own previous close is yesterday's rather than the close before
 *  whatever window Yahoo would have defaulted to. */
const QUOTE_RANGE = '1d'

// Yahoo pads gaps with nulls; keeping the null in the column type is what lets the row be dropped
// instead of read as a zero close. Every column is optional because a window the exchange never
// opened in answers `quote: [{}]` with no timestamps — a closed session, not a broken payload.
const COLUMN = z.array(z.number().nullable()).optional()

const QUOTE_COLUMNS = z.object({
  open: COLUMN,
  high: COLUMN,
  low: COLUMN,
  close: COLUMN,
  volume: COLUMN,
})

const CHART = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            instrumentType: z.string().optional(),
            regularMarketPrice: z.number().optional(),
            previousClose: z.number().optional(),
            chartPreviousClose: z.number().optional(),
            regularMarketTime: z.number().optional(),
            exchangeTimezoneName: z.string().optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({ quote: z.array(QUOTE_COLUMNS) }).optional(),
        })
      )
      .nonempty(),
  }),
})

type ChartResult = z.infer<typeof CHART>['chart']['result'][number]

export function createYahooSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [quoteSource(options), barsSource(options), fxSource(options), fxHistorySource(options)]
}

function quoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: YAHOO_ID,
    kind: 'quote',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    request: (context) => {
      const listing = yahooListing(context)

      return listing
        ? { ...QUOTE_ATTEMPT_LIMITS, ...chartRequest(listing.symbol, { range: QUOTE_RANGE }) }
        : null
    },
    parse: (raw, context) =>
      parsedSource(toQuote(firstResult(raw), context), proxyCaveats(context)),
    observedAt: (value) => value.observedAt,
  })
}

function barsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: YAHOO_ID,
    kind: 'bars',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    request: (context) => {
      const listing = yahooListing(context)

      return listing && context.fromDay && context.toDay
        ? {
            ...chartRequest(listing.symbol, {
              period1: String(utcDayStartEpochSeconds(context.fromDay)),
              period2: String(utcDayEndEpochSeconds(context.toDay)),
            }),
            ...(listing.missStatuses === undefined
              ? {}
              : { businessMissStatuses: listing.missStatuses }),
          }
        : null
    },
    parse: (raw, context) => {
      const result = firstResult(raw)

      assertListingType(result, yahooListing(context)?.expect)

      return parsedSource(toCandles(result, context.toDay), proxyCaveats(context))
    },
  })
}

// Yahoo's FX symbols are `USDVND=X`. An FX pair has no owning market, so it travels as the
// context's market-less ticker; a non-pair symbol simply is not covered by this source.
function fxSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: YAHOO_ID,
    kind: 'fx',
    format: 'json',
    http: options.http,
    covers: (context) => fxPairTicker(context) !== undefined,
    request: (context) => {
      const pair = fxPairTicker(context)

      return pair === undefined ? null : chartRequest(`${pair}=X`, { range: QUOTE_RANGE })
    },
    parse: (raw, context, fetchedAt) =>
      parsedSource(toFxQuote(firstResult(raw), context, fetchedAt)),
  })
}

/** The same symbol over a dated window. Separate from `fx` so a caller wanting today's rate never
 *  pays for a month of them, and because a spot quote carries no history to read back. */
function fxHistorySource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: YAHOO_ID,
    kind: 'fxHistory',
    format: 'json',
    http: options.http,
    covers: (context) => fxHistoryListing(context) !== undefined,
    request: (context) => {
      const listing = fxHistoryListing(context)

      return listing !== undefined && context.fromDay && context.toDay
        ? chartRequest(listing.symbol, {
            period1: String(utcDayStartEpochSeconds(context.fromDay)),
            period2: String(utcDayEndEpochSeconds(context.toDay)),
          })
        : null
    },
    parse: (raw, context) => {
      const result = firstResult(raw)

      assertListingType(result, fxHistoryListing(context)?.expect)

      return parsedSource(toFxRatePoints(result, context.toDay))
    },
  })
}

interface FxHistoryListing {
  readonly symbol: string
  readonly expect?: readonly string[]
}

// A coin's dollar leg is dated too, or a past day's bridged rate would carry today's peg.
function fxHistoryListing(context: SourceContext): FxHistoryListing | undefined {
  const pair = fxPairTicker(context)

  if (pair !== undefined) {
    return { symbol: `${pair}=X` }
  }

  const coin = context.ticker === undefined ? undefined : COIN_USD_PAIR_RE.exec(context.ticker)?.[1]

  return coin === undefined ? undefined : { symbol: `${coin}-USD`, expect: CRYPTO_LISTING_TYPES }
}

/** The ticker only when it names a pair of two ISO codes, the shape Yahoo lists as `=X`. */
function fxPairTicker(context: SourceContext): string | undefined {
  return context.ticker !== undefined && CURRENCY_PAIR_RE.test(context.ticker)
    ? context.ticker
    : undefined
}

interface YahooListing {
  readonly symbol: string
  /** What `meta.instrumentType` must come back as. A ticker fetched as one listing that answers
   *  as another is a different instrument with the same name. */
  readonly expect: readonly string[]
  /** Statuses that answer "not listed here" rather than fail the read. Absent where the symbol came
   *  from a total mapping, whose 404 is that mapping breaking. */
  readonly missStatuses?: readonly number[]
}

function yahooListing(context: SourceContext): YahooListing | undefined {
  const instrument = context.instrument

  if (instrument === undefined) {
    return undefined
  }

  const metal = fromCodeTable(METAL_DELIVERY_MONTHS, instrument.ticker)

  return metal === undefined
    ? {
        symbol: `${instrument.ticker}${USD_PAIR_SUFFIX}`,
        expect: CRYPTO_LISTING_TYPES,
        missStatuses: COIN_PAIR_MISS_STATUSES,
      }
    : { symbol: metalSymbol(metal, context.toDay), expect: FUTURES_LISTING_TYPES }
}

/** The nearest delivery month strictly after the one being read, which is never the spot month in
 *  expiry. A request carrying no day is the quote, and the undated root answers that one from the
 *  active contract through `meta` — measured 2026-09-11, `GC=F` meta 4.408,90 against `GCZ26.CMX`
 *  4.408,90 — so both legs read the same instrument. The root's own bar series does not, which is
 *  why the dated symbol is what the window asks for. */
function metalSymbol(
  metal: { readonly root: string; readonly months: readonly number[] },
  day: TradingDay | undefined
): string {
  const year = day === undefined ? Number.NaN : Number(day.slice(0, 4))
  const month = day === undefined ? Number.NaN : Number(day.slice(5, 7))

  if (!(Number.isInteger(year) && Number.isInteger(month))) {
    return `${metal.root}${FUTURES_ROOT_SUFFIX}`
  }

  const next = metal.months.find((candidate) => candidate > month)
  const delivery = next ?? metal.months[0]

  if (delivery === undefined) {
    return `${metal.root}${FUTURES_ROOT_SUFFIX}`
  }

  const code = FUTURES_MONTH_CODES[delivery - 1]
  const deliveryYear = String((next === undefined ? year + 1 : year) % 100).padStart(2, '0')

  return `${metal.root}${code}${deliveryYear}${COMEX_SUFFIX}`
}

/** A ticker fetched as one listing must have answered as it. Source-boundary copy, deliberately
 *  outside the locale catalogs: the operator never reads it, the next maintainer does. */
function assertListingType(result: ChartResult, expect: readonly string[] | undefined): void {
  if (expect === undefined) {
    return
  }

  const answered = result.meta.instrumentType

  if (answered === undefined || !expect.includes(answered)) {
    throw new ValidationError(
      `yahoo answered ${answered ?? 'no instrument type'}, expected ${expect.join(' or ')}`
    )
  }
}

function chartRequest(
  symbol: string,
  range?: Readonly<Record<string, string>>
): { readonly path: string; readonly query: Readonly<Record<string, string>> } {
  return {
    path: `/v8/finance/chart/${encodeURIComponent(symbol)}`,
    query: { interval: DAILY_INTERVAL, ...range },
  }
}

function firstResult(raw: unknown): ChartResult {
  const [result] = CHART.parse(raw).chart.result

  if (!result) {
    throw new ValidationError('yahoo chart returned no result')
  }

  return result
}

function toQuote(result: ChartResult, context: SourceContext): Quote {
  if (!context.instrument) {
    throw new ValidationError('yahoo quote requires an instrument')
  }

  const observedAt = result.meta.regularMarketTime

  if (observedAt === undefined) {
    throw new ValidationError('yahoo quote has no observation time')
  }

  const price = positive(result.meta.regularMarketPrice, 'regularMarketPrice')
  // This endpoint populates `chartPreviousClose` and leaves `previousClose` null for futures and FX,
  // which is every symbol quoted here. It means "the close before the range", so it is the previous
  // session only because the request pins one session — hence QUOTE_RANGE rather than the default.
  const previousClose = result.meta.previousClose ?? result.meta.chartPreviousClose

  return {
    instrument: context.instrument,
    price,
    ...(previousClose === undefined || previousClose <= 0
      ? {}
      : { changePct: ((price - previousClose) / previousClose) * PERCENT_PER_UNIT }),
    observedAt: observedAt * MS_PER_SECOND,
  }
}

/** Yahoo appends the session in progress to a daily series. `toDay` is what leaves it out: it is
 *  the market's own last settled session, so a partial bar falls outside the window. */
function toCandles(result: ChartResult, toDay: TradingDay | undefined): readonly Candle[] {
  const timestamps = result.timestamp
  const columns = result.indicators?.quote[0]

  // No series is what a closed window looks like. Empty reads as `source.empty-window` downstream,
  // where a throw would claim the provider sent something unparseable.
  if (!(timestamps && columns && toDay)) {
    return []
  }

  return dropInvalid(sessionRows(result, timestamps, toDay), (row) =>
    // A null in any column is a padded gap; `toCandle` rejects the row.
    toCandle({
      at: row.day,
      open: columns.open?.[row.index] ?? undefined,
      high: columns.high?.[row.index] ?? undefined,
      low: columns.low?.[row.index] ?? undefined,
      close: columns.close?.[row.index] ?? undefined,
      volume: columns.volume?.[row.index] ?? undefined,
      adjustment: 'raw',
    })
  )
}

interface SessionRow {
  readonly index: number
  readonly day: TradingDay
}

/** One row per session the caller asked for, dated on the exchange's own day: a daily bar carries
 *  its session's start, so no comparison against that instant can tell a settled session from a
 *  forming one. Which sessions are final is the market's judgement, already spent on `toDay` —
 *  asking it a second time here from the exchange's calendar date threw away a COMEX close for the
 *  rest of the New York day. A second row for a day already seen is that session collapsing onto
 *  it. */
function sessionRows(
  result: ChartResult,
  timestamps: readonly number[],
  toDay: TradingDay
): readonly SessionRow[] {
  const timezone = exchangeTimezone(result)
  const seen = new Set<TradingDay>()
  const rows: SessionRow[] = []

  for (const [index, at] of timestamps.entries()) {
    const day = dayFromEpochSeconds(at, timezone)

    if (day > toDay || seen.has(day)) {
      continue
    }

    seen.add(day)
    rows.push({ index, day })
  }

  return rows
}

function toFxQuote(result: ChartResult, context: SourceContext, fetchedAt: number): FxQuote {
  const match = context.ticker ? CURRENCY_PAIR_RE.exec(context.ticker) : null

  if (!match) {
    throw new ValidationError('yahoo fx requires a currency-pair ticker')
  }

  const observedAt = result.meta.regularMarketTime

  if (observedAt === undefined) {
    throw new ValidationError('yahoo fx quote has no observation time')
  }

  return {
    fromCurrency: currencyCode(match[1] ?? ''),
    toCurrency: currencyCode(match[2] ?? ''),
    rate: positive(result.meta.regularMarketPrice, 'regularMarketPrice'),
    asOf: dayFromEpochSeconds(observedAt, exchangeTimezone(result)),
    sourceId: YAHOO_ID,
    fetchedAt,
  }
}

/** Closes only: a pair has no volume, and a padded null is a session the FX tape never printed. */
function toFxRatePoints(
  result: ChartResult,
  toDay: TradingDay | undefined
): readonly FxRatePoint[] {
  const timestamps = result.timestamp
  const closes = result.indicators?.quote[0]?.close

  if (!(timestamps && closes && toDay)) {
    return []
  }

  return dropInvalid(sessionRows(result, timestamps, toDay), (row) => ({
    day: row.day,
    rate: positive(closes[row.index] ?? undefined, 'close'),
  }))
}

/** Yahoo names the zone in its own payload, so it is untrusted. A name Intl cannot use falls back
 *  to UTC rather than rejecting every bar in the series. */
function exchangeTimezone(result: ChartResult): string {
  const declared = result.meta.exchangeTimezoneName

  return declared !== undefined && isUsableTimezone(declared) ? declared : 'UTC'
}

/** Set only for a metal, the one case where the symbol served is not the instrument asked for. */
function proxyCaveats(context: SourceContext): readonly Caveat[] {
  const ticker = context.instrument?.ticker

  return ticker !== undefined && fromCodeTable(METAL_DELIVERY_MONTHS, ticker) !== undefined
    ? [FUTURES_PROXY_CAVEAT]
    : []
}

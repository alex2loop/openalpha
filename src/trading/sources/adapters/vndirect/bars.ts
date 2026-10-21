import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { MarketRead } from '@/trading/sources/adapters/vndirect/market-read'
import type { ParsedSource, SourceAdapterOptions } from '@/trading/sources/define'
import type { PagedSourceRequest, SourceFetchOutcome } from '@/trading/sources/types'
import { ValidationError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { isLevelKind, tradingDay } from '@/trading/kernel/instrument'
import {
  DEFAULT_PAGE_SIZE,
  MARKET_PAGE_SIZE,
  marketSort,
  VNDIRECT_ID,
} from '@/trading/sources/adapters/vndirect/client'
import { createMarketRead, readMarketWindow } from '@/trading/sources/adapters/vndirect/market-read'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  nonNegative,
  pageRows,
  parseRow,
  positive,
  THOUSAND_VND_PER_UNIT,
  toCandle,
  toScaledPrice,
  utcDayStartEpochMs,
} from '@/trading/sources/rows/normalization'

/** A tail refresh asks every name for the same short window, which the market-wide read answers a
 *  session at a time. A backfill spans a year, where that read is hundreds of requests, so it stays
 *  per-ticker. */
const MARKET_READ_MAXIMUM_DAYS = 45

/** The `/v4/stock_prices` day column, which is also the market read's row identity. */
const BAR_DAY_FIELD = 'date'

const BAR_ROW = z.object({
  code: z.string().min(1),
  date: z.string().min(1),
  open: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  close: z.number().optional(),
  adOpen: z.number().optional(),
  adHigh: z.number().optional(),
  adLow: z.number().optional(),
  adClose: z.number().optional(),
  nmVolume: z.number(),
  nmValue: z.number().optional(),
})

export function barsSource(options: SourceAdapterOptions): RegisteredSource {
  const market = createMarketRead(BAR_DAY_FIELD)

  return createSource({
    id: VNDIRECT_ID,
    kind: 'bars',
    http: options.http,
    // `/v4/stock_prices` carries `type: "STOCK"` rows only, so an index or a futures contract
    // asked of it answers an empty window and spends a request to say nothing.
    covers: (context) => context.instrument !== undefined && !isLevelKind(context.instrumentKind),
    load: (context, signal) => loadBars({ options, market }, context, signal),
  })
}

interface BarsDeps {
  readonly options: SourceAdapterOptions
  readonly market: MarketRead
}

interface BarWindow {
  readonly ticker: string
  readonly fromDay: TradingDay
  readonly toDay: TradingDay
}

async function loadBars(
  deps: BarsDeps,
  context: SourceContext,
  signal: AbortSignal
): Promise<SourceFetchOutcome<ParsedSource<readonly Candle[]>>> {
  const window = barWindow(context)

  if (window === null) {
    return { kind: 'error', code: 'source.symbol-not-found' }
  }

  const rows = await barRows(deps, window, signal)

  return rows.kind === 'error'
    ? rows
    : { ...rows, value: parsedSource(oldestFirst(dropInvalid(rows.value, toBarCandle))) }
}

/** The provider answers newest-first whatever `sort` asks of it, and a bars source owes its callers
 *  the oldest session first — every consumer reads the tail as the latest one. */
function oldestFirst(candles: readonly Candle[]): readonly Candle[] {
  return [...candles].sort((left, right) => left.at.localeCompare(right.at))
}

async function barRows(
  deps: BarsDeps,
  window: BarWindow,
  signal: AbortSignal
): Promise<SourceFetchOutcome<readonly unknown[]>> {
  const pages = (request: PagedSourceRequest): Promise<SourceFetchOutcome<readonly unknown[]>> =>
    deps.options.http.getJsonPages(request, pageRows)

  return spanDays(window) > MARKET_READ_MAXIMUM_DAYS
    ? pages(barRequest({ window, ticker: window.ticker, signal }))
    : deps.market.forTicker({
        key: `${window.fromDay}|${window.toDay}`,
        ticker: window.ticker,
        signal,
        load: () =>
          readMarketWindow({
            http: deps.options.http,
            window,
            pageSize: MARKET_PAGE_SIZE,
            request: (part) => barRequest({ window: { ...window, ...part }, signal }),
          }),
      })
}

function barWindow(context: SourceContext): BarWindow | null {
  const { instrument, fromDay, toDay } = context

  if (instrument === undefined || fromDay === undefined || toDay === undefined) {
    return null
  }

  return { ticker: instrument.ticker, fromDay, toDay }
}

interface BarRequestOptions {
  readonly window: BarWindow
  readonly signal: AbortSignal
  /** Absent for the market-wide read every ticker shares. */
  readonly ticker?: string
}

function barRequest(options: BarRequestOptions): PagedSourceRequest {
  const { window, ticker } = options
  const pageSize = ticker === undefined ? MARKET_PAGE_SIZE : DEFAULT_PAGE_SIZE
  const scope = ticker === undefined ? '' : `code:${ticker}~`

  return {
    sourceId: VNDIRECT_ID,
    path: '/v4/stock_prices',
    pageSize,
    query: {
      sort: marketSort(BAR_DAY_FIELD, 'asc'),
      q: `${scope}${BAR_DAY_FIELD}:gte:${window.fromDay}~${BAR_DAY_FIELD}:lte:${window.toDay}`,
      size: String(pageSize),
    },
    signal: options.signal,
  }
}

function spanDays(window: BarWindow): number {
  return (utcDayStartEpochMs(window.toDay) - utcDayStartEpochMs(window.fromDay)) / MS_PER_DAY
}

function toBarCandle(raw: unknown): Candle {
  const row = parseRow(BAR_ROW, raw, 'vndirect bar')
  const adjusted = adjustedPrices(row)
  const prices = adjusted ?? rawPrices(row)

  return toCandle({
    at: tradingDay(row.date),
    open: toScaledPrice(prices.open, THOUSAND_VND_PER_UNIT),
    high: toScaledPrice(prices.high, THOUSAND_VND_PER_UNIT),
    low: toScaledPrice(prices.low, THOUSAND_VND_PER_UNIT),
    close: toScaledPrice(prices.close, THOUSAND_VND_PER_UNIT),
    volume: nonNegative(row.nmVolume, 'nmVolume'),
    // nmValue is already VND — the multiplier is for prices only.
    ...(row.nmValue === undefined ? {} : { turnover: row.nmValue }),
    adjustment: adjusted ? 'adjusted' : 'raw',
  })
}

interface OhlcPrices {
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
}

// All four or none. A partial adjusted set mixed with raw fields produces a candle that never
// traded, and nothing downstream could detect it.
function adjustedPrices(row: z.infer<typeof BAR_ROW>): OhlcPrices | null {
  const { adOpen, adHigh, adLow, adClose } = row

  if (
    adOpen === undefined ||
    adHigh === undefined ||
    adLow === undefined ||
    adClose === undefined
  ) {
    return null
  }

  return {
    open: positive(adOpen, 'adOpen'),
    high: positive(adHigh, 'adHigh'),
    low: positive(adLow, 'adLow'),
    close: positive(adClose, 'adClose'),
  }
}

function rawPrices(row: z.infer<typeof BAR_ROW>): OhlcPrices {
  const { open, high, low, close } = row

  if (open === undefined || high === undefined || low === undefined || close === undefined) {
    throw new ValidationError(`vndirect row for ${row.code} has no usable price set`)
  }

  return {
    open: positive(open, 'open'),
    high: positive(high, 'high'),
    low: positive(low, 'low'),
    close: positive(close, 'close'),
  }
}

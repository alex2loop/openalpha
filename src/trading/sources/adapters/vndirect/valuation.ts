import { z } from 'zod'

import type { Ticker, TradingDay } from '@/trading/kernel/instrument'
import type { ValuationPoint, ValuationRatios } from '@/trading/kernel/market/valuation'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { MARKET_PAGE_SIZE, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, pageRows, parseRow } from '@/trading/sources/rows/normalization'

const RATIOS_PATH = '/v4/ratios'
const RATIO_ROW = z.object({
  code: z.string().min(1),
  reportDate: z.string().min(1),
  itemCode: z.string().min(1),
  value: z.number(),
})
/** VNDirect's item codes: daily P/E and P/B, and the five-year averages it publishes beside them. */
const DAILY_FIELDS = Object.freeze({
  '51006': 'priceToEarnings',
  '51012': 'priceToBook',
} as const)
const RATIO_FIELDS = Object.freeze({
  ...DAILY_FIELDS,
  '1000043': 'averagePriceToEarnings5y',
  '1000050': 'averagePriceToBook5y',
} as const)
const HISTORY_ITEMS = Object.keys(DAILY_FIELDS).join(',')
const MARKET_ITEMS = Object.keys(RATIO_FIELDS).join(',')
/** Pages are cut in sort order, so the sort must be unique per row: on one market-wide day every
 *  row shares its date, and sorting on it repeated 426 of 5,426 rows across two pages and dropped
 *  as many (measured 2026-10-05). */
const HISTORY_SORT = 'reportDate:asc,itemCode:asc'
const MARKET_SORT = 'code:asc,itemCode:asc'

type RatioItem = keyof typeof RATIO_FIELDS
type RatioField = (typeof RATIO_FIELDS)[RatioItem]

interface RatioRow {
  readonly ticker: Ticker
  readonly day: TradingDay
  readonly field: RatioField
  readonly value: number
}

interface RatioQuery {
  readonly q: string
  readonly sort: string
}

/** One name's history from `fromDay`, or every name on `toDay`, which is empty on a day the
 *  exchange did not trade. */
function toQuery(context: SourceContext): RatioQuery | null {
  if (context.ticker !== undefined) {
    return context.fromDay === undefined
      ? null
      : {
          q: `code:${context.ticker}~itemCode:${HISTORY_ITEMS}~reportDate:gte:${context.fromDay}`,
          sort: HISTORY_SORT,
        }
  }

  return context.toDay === undefined
    ? null
    : { q: `itemCode:${MARKET_ITEMS}~reportDate:${context.toDay}`, sort: MARKET_SORT }
}

function isRatioItem(code: string): code is RatioItem {
  return Object.hasOwn(RATIO_FIELDS, code)
}

function toRatioRow(raw: unknown): RatioRow {
  const row = parseRow(RATIO_ROW, raw, 'vndirect ratio')

  if (!isRatioItem(row.itemCode)) {
    throw new ValidationError('vndirect ratio row carries an unread item')
  }

  if (row.value <= 0) {
    throw new ValidationError('vndirect ratio row carries no positive value')
  }

  return {
    ticker: ticker(row.code),
    day: tradingDay(row.reportDate),
    field: RATIO_FIELDS[row.itemCode],
    value: row.value,
  }
}

interface PointDraft {
  readonly ticker: Ticker
  readonly day: TradingDay
  readonly ratios: Partial<Record<RatioField, number>>
}

/** Rows arrive one per ratio; a name's ratios on one session fold into one point. */
function toPoints(rows: readonly RatioRow[]): readonly ValuationPoint[] {
  const drafts = new Map<string, PointDraft>()

  for (const row of rows) {
    const key = `${row.ticker}|${row.day}`
    const draft = drafts.get(key) ?? { ticker: row.ticker, day: row.day, ratios: {} }

    drafts.set(key, { ...draft, ratios: { ...draft.ratios, [row.field]: row.value } })
  }

  return [...drafts.values()]
    .map((draft): ValuationPoint => ({ ticker: draft.ticker, day: draft.day, ...draft.ratios }))
    .sort(
      (left, right) => left.day.localeCompare(right.day) || left.ticker.localeCompare(right.ticker)
    )
}

function toValuationRatios(raw: unknown, fetchedAt: number): ValuationRatios {
  const points = toPoints(dropInvalid(pageRows(raw), toRatioRow))

  if (points.length === 0) {
    throw new ValidationError('vndirect ratios returned no positive ratio')
  }

  return { points, sourceId: VNDIRECT_ID, fetchedAt }
}

export function valuationSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'valuationRatios',
    format: 'json',
    http: options.http,
    covers: (context) => toQuery(context) !== null,
    request: (context) => {
      const query = toQuery(context)

      return query === null
        ? null
        : { path: RATIOS_PATH, query: { ...query, size: String(MARKET_PAGE_SIZE) } }
    },
    paged: { pageSize: MARKET_PAGE_SIZE, extractRows: pageRows },
    parse: (raw, _context, fetchedAt) => parsedSource(toValuationRatios(raw, fetchedAt)),
  })
}

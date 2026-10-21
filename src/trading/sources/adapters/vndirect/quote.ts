import { z } from 'zod'

import type { Quote, SessionSoFar } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { isLevelKind, ticker, tradingDay } from '@/trading/kernel/instrument'
import { resolveLocalTimeAt } from '@/trading/markets/calendar'
import { VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  finite,
  nonNegative,
  pageRows,
  parseRow,
  positive,
  THOUSAND_VND_PER_UNIT,
  toScaledPrice,
} from '@/trading/sources/rows/normalization'
import { QUOTE_ATTEMPT_LIMITS } from '@/trading/sources/transport/http'

/** The clock this endpoint stamps its rows on. A provider fact about the feed, not the exchange
 *  policy a market owns. */
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'
/** Calendar days of history the newest row may come from, with slack for a name halted or a market
 *  shut across a Tet break. */
const QUOTE_LOOKBACK_DAYS = 14
/** `HH:mm:ss` trimmed to the minute the day's instant is resolved from. */
const CLOCK_MINUTES = 5
const QUOTE_PAGE_SIZE = 4

/** `time` advances through the session while `date` stays today, so one row answers both "what is it
 *  trading at" and "what did it close at" — which reading arrived is the calendar's judgment, not
 *  this adapter's. */
const QUOTE_ROW = z.object({
  code: z.string().min(1),
  date: z.string().min(1),
  time: z.string().min(1),
  close: z.number(),
  pctChange: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  nmVolume: z.number().optional(),
})

/** The same `/v4/stock_prices` rows the bars source reads, asked for the newest session rather than a
 *  window. Unlike a chart series this row is written while the session runs, which is what lets it
 *  answer a live price for a name whose chart feed has not caught up. */
export function quoteSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'quote',
    format: 'json',
    http: options.http,
    // `/v4/stock_prices` carries `type: "STOCK"` rows only, so an index or a futures contract asked
    // of it answers an empty page and this source leads the route into rejecting its own payload.
    covers: (context) => context.instrument !== undefined && !isLevelKind(context.instrumentKind),
    request: (context) => {
      if (context.instrument === undefined || context.toDay === undefined) {
        return null
      }

      return {
        ...QUOTE_ATTEMPT_LIMITS,
        path: '/v4/stock_prices',
        query: {
          q: `code:${context.instrument.ticker}~date:gte:${lookbackFrom(context.toDay)}~date:lte:${context.toDay}`,
          sort: 'date:desc',
          size: String(QUOTE_PAGE_SIZE),
        },
      }
    },
    parse: (raw, context) => parsedSource(toQuote(pageRows(raw), context)),
    observedAt: (value) => value.observedAt,
  })
}

/** The row's own high, low and volume cover the whole session, so they carry no start of their own:
 *  the quoting market fills that from its calendar. */
function sessionOf(row: z.infer<typeof QUOTE_ROW>): SessionSoFar | undefined {
  const { high, low, nmVolume } = row

  if (high === undefined || low === undefined) {
    return undefined
  }

  return {
    high: toScaledPrice(positive(high, 'high'), THOUSAND_VND_PER_UNIT),
    low: toScaledPrice(positive(low, 'low'), THOUSAND_VND_PER_UNIT),
    ...(nmVolume === undefined ? {} : { volume: nonNegative(nmVolume, 'nmVolume') }),
  }
}

function lookbackFrom(toDay: string): string {
  const from = new Date(Date.parse(toDay) - QUOTE_LOOKBACK_DAYS * MS_PER_DAY)

  return from.toISOString().slice(0, toDay.length)
}

/** Newest first by the query's own sort, so the head row is the reading. */
function toQuote(rows: readonly unknown[], context: SourceContext): Quote {
  const [head] = rows

  if (head === undefined || context.instrument === undefined) {
    throw new ValidationError('vndirect returned no session to quote from')
  }

  const row = parseRow(QUOTE_ROW, head, 'vndirect quote')
  const changePct = row.pctChange === undefined ? undefined : finite(row.pctChange, 'pctChange')
  const session = sessionOf(row)

  return {
    instrument: { market: context.instrument.market, ticker: ticker(row.code) },
    // The endpoint quotes in thousands of VND, as its bar rows do; every stored price is VND.
    price: toScaledPrice(positive(row.close, 'close'), THOUSAND_VND_PER_UNIT),
    ...(changePct === undefined ? {} : { changePct }),
    ...(session === undefined ? {} : { session }),
    observedAt: resolveLocalTimeAt(
      tradingDay(row.date),
      row.time.slice(0, CLOCK_MINUTES),
      VN_TIMEZONE
    ),
  }
}

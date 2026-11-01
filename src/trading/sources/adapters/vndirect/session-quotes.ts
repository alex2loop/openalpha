import { z } from 'zod'

import type { InstrumentKind, MarketRef } from '@/trading/kernel/instrument'
import type { SessionQuote } from '@/trading/kernel/market/market-data'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { MARKET_PAGE_SIZE, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  finite,
  nonNegative,
  pageRows,
  parseRow,
  THOUSAND_VND_PER_UNIT,
  toScaledPrice,
} from '@/trading/sources/rows/normalization'

/** The provider's own listing labels, mapped to the kinds a market screens by. A label absent here
 *  is a listing this feed carries and the domain has no kind for, so its rows are dropped rather
 *  than counted as shares. */
const LISTING_KINDS: Readonly<Record<string, InstrumentKind>> = Object.freeze({
  STOCK: 'equity',
  ETF: 'etf',
})

const SESSION_ROW = z.object({
  code: z.string().min(1),
  date: z.string().min(1),
  floor: z.string().min(1),
  type: z.string().min(1),
  close: z.number(),
  pctChange: z.number(),
  nmVolume: z.number().optional(),
})

/** The whole board's session in one read: the same `/v4/stock_prices` rows the bars source pages
 *  per name, asked without a code scope. The rows are written while the session runs, which is what
 *  makes a count off them today's rather than yesterday's. */
export function sessionQuotesSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'sessionQuotes',
    format: 'json',
    http: options.http,
    covers: (context) =>
      context.instrument === undefined &&
      context.market !== undefined &&
      context.toDay !== undefined,
    request: (context) => {
      if (context.toDay === undefined) {
        return null
      }

      return {
        path: '/v4/stock_prices',
        query: {
          q: `date:gte:${context.toDay}~date:lte:${context.toDay}`,
          sort: 'date',
          size: String(MARKET_PAGE_SIZE),
        },
      }
    },
    parse: (raw, context) => parsedSource(toSessionQuotes(pageRows(raw), context)),
  })
}

function toSessionQuotes(
  rows: readonly unknown[],
  context: SourceContext
): readonly SessionQuote[] {
  const market = context.market

  if (market === undefined) {
    return []
  }

  // One session of the whole market fits a page today; a full page means names past it were cut,
  // and a tally of part of the board must not read as the board.
  if (rows.length >= MARKET_PAGE_SIZE) {
    throw new ValidationError('vndirect session read filled its page')
  }

  return dropInvalid(rows, (row) => toSessionQuote(row, market)).flat()
}

/** A listing this feed carries and the domain has no kind for is dropped, never counted as a share:
 *  a fund certificate in the tally measures the same names twice. */
function toSessionQuote(row: unknown, market: MarketRef): readonly SessionQuote[] {
  const parsed = parseRow(SESSION_ROW, row, 'stock_prices')
  const kind = LISTING_KINDS[parsed.type]

  if (kind === undefined) {
    return []
  }

  return [
    {
      instrument: { market, ticker: ticker(parsed.code) },
      at: tradingDay(parsed.date),
      kind,
      board: parsed.floor,
      close: toScaledPrice(finite(parsed.close, 'close'), THOUSAND_VND_PER_UNIT),
      changePct: finite(parsed.pctChange, 'pctChange'),
      matchedVolume: nonNegative(parsed.nmVolume ?? 0, 'nmVolume'),
    },
  ]
}

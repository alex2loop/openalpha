import { z } from 'zod'

import type { AnalystRecommendation } from '@/trading/kernel/market/market-data'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import type { RowTarget } from '@/trading/sources/rows/row-target'
import { ticker, tradingDay } from '@/trading/kernel/instrument'
import { DEFAULT_PAGE_SIZE, VND, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import {
  dropInvalid,
  pageRows,
  parseRow,
  positive,
  THOUSAND_VND_PER_UNIT,
} from '@/trading/sources/rows/normalization'
import { resolveRowTarget } from '@/trading/sources/rows/row-target'

const RECOMMENDATION_ROW = z.object({
  code: z.string().min(1),
  reportDate: z.string().min(1),
  type: z.enum(['BUY', 'HOLD', 'SELL']),
  targetPrice: z.number().optional(),
})

type Rating = z.infer<typeof RECOMMENDATION_ROW>['type']

/** A row is one firm's report, not a tally, so each carries its own single vote and the consumer
 *  sums the window it asked for. */
const RATING_VOTE: Readonly<
  Record<Rating, Pick<AnalystRecommendation, 'buyCount' | 'holdCount' | 'sellCount'>>
> = Object.freeze({
  BUY: { buyCount: 1, holdCount: 0, sellCount: 0 },
  HOLD: { buyCount: 0, holdCount: 1, sellCount: 0 },
  SELL: { buyCount: 0, holdCount: 0, sellCount: 1 },
})

export function recommendationsSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'recommendations',
    format: 'json',
    http: options.http,
    covers: (context) => context.instrument !== undefined,
    // The endpoint holds a decade of reports, so the caller's window is pushed into the query
    // rather than filtered after: a rating from 2016 is not today's consensus.
    request: (context) => {
      if (context.instrument === undefined) {
        return null
      }

      const code = `code:${context.instrument.ticker}`

      return {
        path: '/v4/recommendations',
        query: {
          sort: 'reportDate',
          q: context.fromDay === undefined ? code : `${code}~reportDate:gte:${context.fromDay}`,
          size: String(DEFAULT_PAGE_SIZE),
        },
      }
    },
    paged: { pageSize: DEFAULT_PAGE_SIZE, extractRows: pageRows },
    parse: (raw, context, fetchedAt) =>
      parsedSource(
        dropInvalid(pageRows(raw), (row) =>
          toRecommendation(row, resolveRowTarget(context, fetchedAt))
        )
      ),
  })
}

function toRecommendation(raw: unknown, target: RowTarget): AnalystRecommendation {
  const row = parseRow(RECOMMENDATION_ROW, raw, 'vndirect recommendation')

  return {
    instrument: { market: target.market, ticker: ticker(row.code) },
    asOf: tradingDay(row.reportDate),
    ...RATING_VOTE[row.type],
    // Also thousand-VND, same as bars.ts — a target price is a price, not a value.
    ...(row.targetPrice === undefined
      ? {}
      : {
          targetPrice: positive(row.targetPrice, 'targetPrice') * THOUSAND_VND_PER_UNIT,
          currency: VND,
        }),
    sourceId: VNDIRECT_ID,
    fetchedAt: target.fetchedAt,
  }
}

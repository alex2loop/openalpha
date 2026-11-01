import { z } from 'zod'

import type { TradingDay } from '@/trading/kernel/instrument'
import type { IndexCode, IndexRatioId } from '@/trading/kernel/market/index-reading'
import type { RegisteredSource } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { contextIndex, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, pageRows, parseRow } from '@/trading/sources/rows/normalization'

const RATIOS_PATH = '/v4/ratios'
/** Seven ratios a session over the sessions the caller's window spans, with room to spare: the
 *  query sorts newest first, so a page that fills still holds the newest day whole. */
const RATIOS_PAGE_SIZE = '200'
const RATIO_ROW = z.object({
  code: z.string().min(1),
  reportDate: z.string().min(1),
  ratioCode: z.string().min(1),
  value: z.number().finite(),
})

/** The provider's ratio codes, named by what the daemon calls them. */
const RATIO_CODES: Readonly<Record<string, IndexRatioId>> = Object.freeze({
  PRICE_TO_EARNINGS: 'priceToEarnings',
  PRICE_TO_BOOK: 'priceToBook',
  DIVIDEND_YIELD: 'dividendYield',
  PRICE_TO_EARNINGS_AVG_CR_5Y: 'averagePriceToEarnings5y',
  PRICE_TO_BOOK_AVG_CR_5Y: 'averagePriceToBook5y',
  OVER_MA50D_PCT_CR: 'aboveMa50Ratio',
  OVER_MA200D_PCT_CR: 'aboveMa200Ratio',
})
const RATIO_CODE_LIST = Object.keys(RATIO_CODES).join(',')

interface DayRatios {
  readonly day: TradingDay
  readonly ratios: Partial<Record<IndexRatioId, number>>
}

/** An index's own ratios (the provider files them under the index's code, a day at a time). The
 *  window opens at `fromDay` and the newest day with both multiples is the answer, so a session whose
 *  ratios are not out yet falls back to the one before without a second request. */
export function indexValuationSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'indexValuation',
    format: 'json',
    http: options.http,
    covers: (context) => contextIndex(context) !== undefined && context.fromDay !== undefined,
    request: (context) => {
      const index = contextIndex(context)

      return index === undefined || context.fromDay === undefined
        ? null
        : {
            path: RATIOS_PATH,
            query: {
              q: `code:${index}~ratioCode:${RATIO_CODE_LIST}~reportDate:gte:${context.fromDay}`,
              sort: 'reportDate:desc',
              size: RATIOS_PAGE_SIZE,
            },
          }
    },
    parse: (raw, context, fetchedAt) => {
      const index = contextIndex(context)

      if (index === undefined) {
        throw new ValidationError('vndirect index ratios asked without an index')
      }

      const newest = newestDay(dropInvalid(pageRows(raw), (row) => toRatio(row, index)))

      return parsedSource({
        index,
        day: newest.day,
        ratios: newest.ratios,
        sourceId: VNDIRECT_ID,
        fetchedAt,
      })
    },
  })
}

interface RatioRow {
  readonly day: TradingDay
  readonly id: IndexRatioId
  readonly value: number
}

function toRatio(raw: unknown, index: IndexCode): RatioRow {
  const row = parseRow(RATIO_ROW, raw, 'vndirect index ratio')
  const id = Object.hasOwn(RATIO_CODES, row.ratioCode) ? RATIO_CODES[row.ratioCode] : undefined

  if (row.code !== index || id === undefined) {
    throw new ValidationError('vndirect index ratio row is not one asked for')
  }

  return { day: tradingDay(row.reportDate), id, value: row.value }
}

function newestDay(rows: readonly RatioRow[]): DayRatios {
  const days = new Map<TradingDay, Partial<Record<IndexRatioId, number>>>()

  for (const row of rows) {
    days.set(row.day, { ...days.get(row.day), [row.id]: row.value })
  }

  const newest = [...days.entries()]
    .filter(
      ([, ratios]) => ratios.priceToEarnings !== undefined && ratios.priceToBook !== undefined
    )
    .sort(([left], [right]) => right.localeCompare(left))[0]

  if (newest === undefined) {
    throw new ValidationError('vndirect index ratios returned no day with both multiples')
  }

  return { day: newest[0], ratios: newest[1] }
}

import { z } from 'zod'

import type { CommodityHistory, CommodityId } from '@/trading/kernel/market/commodity'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { toCommodityId } from '@/trading/kernel/market/commodity'
import { DEFAULT_PAGE_SIZE, VNDIRECT_ID } from '@/trading/sources/adapters/vndirect/client'
import { createSource, parsedSource } from '@/trading/sources/define'
import { dropInvalid, pageRows, parseRow } from '@/trading/sources/rows/normalization'

const COMMODITIES_PATH = '/v4/commodities'
/** Every row is published once per locale; one locale is the whole series. */
const ROW_LOCALE = 'VN'
const COMMODITY_ROW = z.object({
  code: z.string().min(1),
  tradingDate: z.string().min(1),
  closePrice: z.number(),
})
/** Front-month futures, and LME three-month forwards for the base metals. Rubber reads Tokyo
 *  because the Shanghai row stopped printing; copper reads LME because COMEX quotes it in cents. */
const COMMODITY_CODES: Readonly<Partial<Record<CommodityId, string>>> = Object.freeze({
  BRENT: 'GEN1ST_BRENT_OIL',
  'NATURAL-GAS': 'GEN1ST_N_GAS',
  'IRON-ORE': 'GEN1ST_TIO',
  COPPER: 'FW3M_COPPER',
  ALUMINIUM: 'FW3M_ALUMI',
  RUBBER: 'GEN1ST_RUB_TCM',
  SUGAR: 'GEN1ST_SUGAR11',
  COFFEE: 'GEN1ST_COFF_C',
})

function toCode(context: SourceContext): string | undefined {
  const commodity = toCommodityId(context.ticker)

  return commodity === undefined ? undefined : COMMODITY_CODES[commodity]
}

/** A holiday prints as a row of zeros, which is no price. The feed keeps about a year, so one
 *  page answers any window. */
function toHistory(raw: unknown, context: SourceContext, fetchedAt: number): CommodityHistory {
  const commodity = toCommodityId(context.ticker)
  const points = dropInvalid(pageRows(raw), (row) =>
    parseRow(COMMODITY_ROW, row, 'vndirect commodity')
  )
    .filter((row) => row.closePrice > 0)
    .map((row) => ({ day: tradingDay(row.tradingDate), close: row.closePrice }))
    .sort((left, right) => left.day.localeCompare(right.day))

  if (commodity === undefined || points.length === 0) {
    throw new ValidationError('vndirect commodities returned no priced row')
  }

  return { commodity, points, sourceId: VNDIRECT_ID, fetchedAt }
}

export function commoditiesSource(options: SourceAdapterOptions): RegisteredSource {
  return createSource({
    id: VNDIRECT_ID,
    kind: 'commodityPrices',
    format: 'json',
    http: options.http,
    covers: (context) => context.fromDay !== undefined && toCode(context) !== undefined,
    request: (context) => {
      const code = toCode(context)

      return code === undefined || context.fromDay === undefined
        ? null
        : {
            path: COMMODITIES_PATH,
            query: {
              q: `code:${code}~locale:${ROW_LOCALE}~tradingDate:gte:${context.fromDay}`,
              size: String(DEFAULT_PAGE_SIZE),
            },
          }
    },
    parse: (raw, context, fetchedAt) => parsedSource(toHistory(raw, context, fetchedAt)),
  })
}

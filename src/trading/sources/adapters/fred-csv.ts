// Source class: free, official. FRED's keyless chart download, for the monthly commodity series no
// free daily feed carries. It answers a plain user agent only, and now and then serves an HTML bot
// check in place of the file: a body without the CSV header fails the parse, never reads as empty.

import type {
  CommodityHistory,
  CommodityId,
  CommodityPoint,
} from '@/trading/kernel/market/commodity'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceAdapterOptions } from '@/trading/sources/define'
import { ValidationError } from '@/core/errors'
import { tradingDay } from '@/trading/kernel/instrument'
import { toCommodityId } from '@/trading/kernel/market/commodity'
import { sourceId } from '@/trading/kernel/source/source-id'
import { createSource, parsedSource } from '@/trading/sources/define'

const FRED_CSV_ID = sourceId('fred-csv')
const CSV_PATH = '/graph/fredgraph.csv'
const CSV_HEADER = 'observation_date,'
const MISSING_OBSERVATION = '.'
/** World Bank monthly prices in USD, and the US producer price index for steel mill products. */
const FRED_COMMODITY_SERIES: Readonly<Partial<Record<CommodityId, string>>> = Object.freeze({
  COAL: 'PCOALAUUSDM',
  RICE: 'PRICENPQUSDM',
  PORK: 'PPORKUSDM',
  STEEL: 'WPU101',
})

export const FRED_CSV_DEFAULT_ENDPOINT = 'https://fred.stlouisfed.org'

function toSeries(context: SourceContext): string | undefined {
  const commodity = toCommodityId(context.ticker)

  return commodity === undefined ? undefined : FRED_COMMODITY_SERIES[commodity]
}

function toPoint(line: string): CommodityPoint | undefined {
  const [day, value] = line.trim().split(',')

  if (day === undefined || value === undefined || value === MISSING_OBSERVATION) {
    return undefined
  }

  const close = Number(value)

  return Number.isFinite(close) && close > 0 ? { day: tradingDay(day), close } : undefined
}

function toHistory(raw: unknown, context: SourceContext, fetchedAt: number): CommodityHistory {
  if (typeof raw !== 'string') {
    throw new ValidationError('fred csv did not return text')
  }

  const [header, ...lines] = raw.trim().split('\n')
  const commodity = toCommodityId(context.ticker)

  if (commodity === undefined || header?.startsWith(CSV_HEADER) !== true) {
    throw new ValidationError('fred csv answered without its header')
  }

  const points = lines.flatMap((line) => toPoint(line) ?? [])

  if (points.length === 0) {
    throw new ValidationError('fred csv returned no observation')
  }

  return { commodity, points, sourceId: FRED_CSV_ID, fetchedAt }
}

export function createFredCsvSources(options: SourceAdapterOptions): readonly RegisteredSource[] {
  return [
    createSource({
      id: FRED_CSV_ID,
      kind: 'commodityPrices',
      format: 'text',
      http: options.http,
      covers: (context) => context.fromDay !== undefined && toSeries(context) !== undefined,
      request: (context) => {
        const series = toSeries(context)

        return series === undefined || context.fromDay === undefined
          ? null
          : { path: CSV_PATH, query: { id: series, cosd: context.fromDay } }
      },
      parse: (raw, context, fetchedAt) => parsedSource(toHistory(raw, context, fetchedAt)),
    }),
  ]
}

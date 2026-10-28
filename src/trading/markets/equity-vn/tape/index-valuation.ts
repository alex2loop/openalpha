import type { TradingDay } from '@/trading/kernel/instrument'
import type { IndexRatioId, IndexValuationReading } from '@/trading/kernel/market/index-reading'
import type { IndexRequest } from '@/trading/kernel/market/market-capability'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketCapabilities } from '@/trading/markets/types'
import { sourcedCaveat } from '@/trading/kernel/caveat'
import { INDEX_RATIO_IDS, indexRatioSeriesId } from '@/trading/kernel/market/index-reading'
import { sourceId } from '@/trading/kernel/source/source-id'
import { available, unavailable } from '@/trading/kernel/source/source-result'
import { shiftCalendarDay } from '@/trading/markets/calendar'

const RATIOS_SOURCE = sourceId('vndirect')
/** A weekend plus a holiday cluster leaves a week or more without a new day, so a reading this old
 *  still describes the market; past it the refresh has been failing. */
const INDEX_VALUATION_STALE_AFTER_DAYS = 10

interface StoredRatio {
  readonly day: TradingDay
  readonly value: number
  readonly fetchedAt: number
}

/** What the refresh last stored for the index. The provider is never asked here: this is read while
 *  a page loads. */
export function createIndexValuation(
  deps: MarketDeps
): NonNullable<MarketCapabilities['indexValuation']> {
  return {
    kind: 'indexValuation',
    async run(request: IndexRequest): Promise<SourceResult<IndexValuationReading>> {
      const stored = await readStored(deps, request)
      const earnings = stored.get('priceToEarnings')
      const book = stored.get('priceToBook')

      if (earnings === undefined || book === undefined || earnings.value <= 0) {
        return unavailable('empty', [])
      }

      // Every ratio of the reading is of the day the multiples are; an older point is left out.
      const asOf = earnings.day
      const ratioOfDay = (id: IndexRatioId): number | undefined => {
        const point = stored.get(id)

        return point?.day === asOf ? point.value : undefined
      }
      const dividendYield = ratioOfDay('dividendYield')
      const earnings5y = ratioOfDay('averagePriceToEarnings5y')
      const book5y = ratioOfDay('averagePriceToBook5y')
      const aboveMa50 = ratioOfDay('aboveMa50Ratio')
      const aboveMa200 = ratioOfDay('aboveMa200Ratio')
      const stale = asOf < shiftCalendarDay(request.asOf, -INDEX_VALUATION_STALE_AFTER_DAYS)

      return available(
        {
          index: request.index,
          asOf,
          priceToEarnings: earnings.value,
          priceToBook: book.value,
          returnOnEquity: book.value / earnings.value,
          ...(dividendYield === undefined ? {} : { dividendYield }),
          ...(earnings5y === undefined ? {} : { averagePriceToEarnings5y: earnings5y }),
          ...(book5y === undefined ? {} : { averagePriceToBook5y: book5y }),
          ...(aboveMa50 === undefined ? {} : { aboveMa50Ratio: aboveMa50 }),
          ...(aboveMa200 === undefined ? {} : { aboveMa200Ratio: aboveMa200 }),
        },
        [{ sourceId: RATIOS_SOURCE, fetchedAt: earnings.fetchedAt, freshness: 'cached' }],
        stale
          ? [sourcedCaveat('source.stale-cache', [RATIOS_SOURCE], { sourceKind: 'indexValuation' })]
          : []
      )
    },
  }
}

async function readStored(
  deps: MarketDeps,
  request: IndexRequest
): Promise<ReadonlyMap<IndexRatioId, StoredRatio>> {
  const points = await Promise.all(
    INDEX_RATIO_IDS.map(async (id) => ({
      id,
      point: await deps.marketDataStore.findLatestSeriesPoint({
        seriesId: indexRatioSeriesId(request.index, id),
        signal: request.signal,
      }),
    }))
  )

  return new Map(points.flatMap(({ id, point }) => (point === null ? [] : [[id, point] as const])))
}

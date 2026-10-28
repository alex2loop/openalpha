import type { TradingDay, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexCode, IndexRatioId } from '@/trading/kernel/market/index-reading'
import type { MarketDeps } from '@/trading/markets/deps'
import type { VnMacroCrossSection } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import type { TradingCalendar } from '@/trading/markets/types'
import { MS_PER_DAY } from '@/core/utils/time'
import { ticker } from '@/trading/kernel/instrument'
import {
  INDEX_CODES,
  INDEX_RATIO_IDS,
  indexRatioSeriesId,
} from '@/trading/kernel/market/index-reading'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { aboveMeanRatios } from '@/trading/markets/equity-vn/tape/breadth'

/** Sessions the ratio window opens before the settled day, so a day whose ratios are not out yet
 *  reads as the one before it. */
const INDEX_RATIO_LOOKBACK_SESSIONS = 5

/** The basket whose names stand for an index the provider files no moving-average shares for. */
const INDEX_BASKET_TIERS: Readonly<Partial<Record<IndexCode, VnIndexTier>>> = Object.freeze({
  VN30: 'vn30',
})

interface IndexValuationRefresh {
  readonly deps: MarketDeps
  readonly crossSection: VnMacroCrossSection
  readonly calendar: TradingCalendar
  readonly asOf: TradingDay
  /** The operator asking again on purpose; an ordinary pass leaves an index read today alone. */
  readonly forced: boolean
  readonly now: number
  readonly signal: AbortSignal
}

/** The index ratio series' only writer: one point a day per ratio, kept as the daemon's own
 *  history. The provider is asked at most once an index and UTC day (its quota is shared by every
 *  process on the machine), and a read that fails leaves the series as it stands. */
export async function refreshIndexValuation(input: IndexValuationRefresh): Promise<void> {
  const fromDay = input.calendar.addTradingDays(input.asOf, -INDEX_RATIO_LOOKBACK_SESSIONS)

  await Promise.all(INDEX_CODES.map((index) => refreshIndex(input, index, fromDay)))
}

async function refreshIndex(
  input: IndexValuationRefresh,
  index: IndexCode,
  fromDay: TradingDay
): Promise<void> {
  const { deps, now, signal } = input

  if (!input.forced && (await isReadToday(input, index))) {
    return
  }

  const read = await deps.sources.resolve({
    kind: 'indexValuation',
    context: { market: VN_MARKET_REF, ticker: ticker(index), fromDay },
    signal,
  })

  if (read.kind !== 'available') {
    return
  }

  const ratios = { ...(await basketRatios(input, index, read.value.day)), ...read.value.ratios }

  for (const id of INDEX_RATIO_IDS) {
    const value = ratios[id]

    if (value !== undefined) {
      // Replaced, not kept: the write instant is what the once-a-day read above looks at.
      await deps.marketDataStore.upsertSeriesPoint({
        seriesId: indexRatioSeriesId(index, id),
        day: read.value.day,
        value,
        replace: true,
        now,
        signal,
      })
    }
  }
}

/** What the provider leaves out for an index with a basket: the share of its stored names above
 *  their own means, measured on the day the provider's ratios are of. */
async function basketRatios(
  input: IndexValuationRefresh,
  index: IndexCode,
  day: TradingDay
): Promise<Partial<Record<IndexRatioId, number>>> {
  const tier = INDEX_BASKET_TIERS[index]

  if (tier === undefined) {
    return {}
  }

  const cross = await input.crossSection.get(input.asOf, input.signal)

  return aboveMeanRatios(
    cross.names.filter((name) => name.record.indexTier === tier),
    day
  )
}

/** The multiples are written together with every other ratio, so one series speaks for the read. */
async function isReadToday(input: IndexValuationRefresh, index: IndexCode): Promise<boolean> {
  const latest = await input.deps.marketDataStore.findLatestSeriesPoint({
    seriesId: indexRatioSeriesId(index, 'priceToEarnings'),
    signal: input.signal,
  })

  return (
    latest !== null &&
    Math.floor(latest.fetchedAt / MS_PER_DAY) === Math.floor(input.now / MS_PER_DAY)
  )
}

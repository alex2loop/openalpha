import type { InstrumentRef, TradingDay, VnIndexTier } from '@/trading/kernel/instrument'
import type { IndexCode, IndexRatioId } from '@/trading/kernel/market/index-reading'
import type { RefreshKindResult } from '@/trading/kernel/market/refresh'
import type { MarketDeps } from '@/trading/markets/deps'
import type { VnMacroCrossSection } from '@/trading/markets/equity-vn/evidence/macro-evidence'
import type { TargetOutcome } from '@/trading/markets/refresh-result'
import type { TradingCalendar } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { MS_PER_DAY } from '@/core/utils/time'
import { ticker } from '@/trading/kernel/instrument'
import {
  INDEX_CODES,
  INDEX_RATIO_IDS,
  indexRatioSeriesId,
} from '@/trading/kernel/market/index-reading'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { aboveMeanRatios } from '@/trading/markets/equity-vn/tape/breadth'
import {
  buildRejectedOutcome,
  emptyKindResult,
  toKindResult,
} from '@/trading/markets/refresh-result'

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

/** An index already read today: nothing asked, nothing written. */
type IndexSkip = 'read-today'

/** The index ratio series' only writer: one point a day per ratio, kept as the daemon's own
 *  history. The provider is asked at most once an index and UTC day (its quota is shared by every
 *  process on the machine), and a read or a write that fails leaves the series as it stands and
 *  reports that index missing, never the whole refresh. */
export async function refreshIndexValuation(
  input: IndexValuationRefresh
): Promise<RefreshKindResult> {
  const fromDay = input.calendar.addTradingDays(input.asOf, -INDEX_RATIO_LOOKBACK_SESSIONS)
  const outcomes = await Promise.all(
    INDEX_CODES.map((index) => refreshIndexCaught(input, index, fromDay))
  )
  const attempted = outcomes.filter((outcome) => outcome !== 'read-today')

  if (attempted.length === 0) {
    return emptyKindResult('index-ratios', 'fresh', [])
  }

  return toKindResult({
    kind: 'index-ratios',
    successStatus: 'upserted',
    outcomes: attempted,
    recordCount: attempted.reduce((sum, outcome) => sum + (outcome.value ?? 0), 0),
  })
}

async function refreshIndexCaught(
  input: IndexValuationRefresh,
  index: IndexCode,
  fromDay: TradingDay
): Promise<TargetOutcome<number> | IndexSkip> {
  try {
    return await refreshIndex(input, index, fromDay)
  } catch (err: unknown) {
    if (isAbortError(err) || input.signal.aborted) {
      throw err
    }

    return buildRejectedOutcome(indexRef(index), [])
  }
}

/** How many ratio points the read wrote. */
async function refreshIndex(
  input: IndexValuationRefresh,
  index: IndexCode,
  fromDay: TradingDay
): Promise<TargetOutcome<number> | IndexSkip> {
  const { deps, now, signal } = input

  if (!input.forced && (await isReadToday(input, index))) {
    return 'read-today'
  }

  const read = await deps.sources.resolve({
    kind: 'indexValuation',
    context: { ...indexRef(index), fromDay },
    signal,
  })

  if (read.kind !== 'available') {
    return buildRejectedOutcome(indexRef(index), read.caveats)
  }

  const ratios = { ...(await basketRatios(input, index, read.value.day)), ...read.value.ratios }
  let written = 0

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
      written += 1
    }
  }

  return {
    instrument: indexRef(index),
    value: written,
    provenance: read.provenance,
    caveats: read.caveats,
  }
}

function indexRef(index: IndexCode): InstrumentRef {
  return { market: VN_MARKET_REF, ticker: ticker(index) }
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

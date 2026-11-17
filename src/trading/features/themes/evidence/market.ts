import type {
  EvidenceDeps,
  EvidencePart,
  EvidenceRequest,
} from '@/trading/features/themes/evidence/deps'
import type { EvidenceDraft } from '@/trading/features/themes/types'
import type { CommodityId } from '@/trading/kernel/market/commodity'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import { MONTHLY_STALE_DAYS } from '@/trading/features/themes/evidence/macro'
import {
  formatChange,
  formatFigure,
  formatShare,
  isStale,
  toDayBefore,
  toLookbacks,
} from '@/trading/features/themes/evidence/series'
import { THEME_MARKET } from '@/trading/features/themes/types'
import { ticker } from '@/trading/kernel/instrument'
import { COMMODITY_IDS } from '@/trading/kernel/market/commodity'
import { utcDayOf } from '@/trading/sources/rows/normalization'

const COMMODITY_WINDOW_DAYS = 400
const COMMODITY_CONCURRENCY = 4
const SECTOR_ORIGIN = 'sector-strength'
/** A daily exchange feed rests over a long weekend or a holiday, never longer; the monthly series
 *  share the macro reports' lag. */
const DAILY_STALE_DAYS = 10
const COMMODITIES: Readonly<
  Record<CommodityId, { readonly label: string; readonly staleDays: number }>
> = Object.freeze({
  BRENT: { label: 'Brent crude oil', staleDays: DAILY_STALE_DAYS },
  'NATURAL-GAS': { label: 'US natural gas (Henry Hub)', staleDays: DAILY_STALE_DAYS },
  'IRON-ORE': { label: 'Iron ore 62% Fe', staleDays: DAILY_STALE_DAYS },
  COPPER: { label: 'Copper (LME)', staleDays: DAILY_STALE_DAYS },
  ALUMINIUM: { label: 'Aluminium (LME)', staleDays: DAILY_STALE_DAYS },
  RUBBER: { label: 'Natural rubber (Tokyo)', staleDays: DAILY_STALE_DAYS },
  SUGAR: { label: 'Raw sugar', staleDays: DAILY_STALE_DAYS },
  COFFEE: { label: 'Arabica coffee', staleDays: DAILY_STALE_DAYS },
  COAL: { label: 'Australian thermal coal, monthly', staleDays: MONTHLY_STALE_DAYS },
  RICE: { label: 'Thai rice, monthly', staleDays: MONTHLY_STALE_DAYS },
  PORK: { label: 'Pork, monthly', staleDays: MONTHLY_STALE_DAYS },
  STEEL: {
    label: 'US steel mill products price index, monthly',
    staleDays: MONTHLY_STALE_DAYS,
  },
})

async function readCommodity(
  deps: EvidenceDeps,
  commodity: CommodityId,
  request: EvidenceRequest
): Promise<EvidenceDraft | undefined> {
  const result = await deps.sources.resolve({
    kind: 'commodityPrices',
    context: {
      ticker: ticker(commodity),
      fromDay: toDayBefore(utcDayOf(request.now), COMMODITY_WINDOW_DAYS),
    },
    signal: request.signal,
  })
  const lookbacks =
    result.kind === 'available'
      ? toLookbacks(result.value.points.map((point) => ({ day: point.day, value: point.close })))
      : undefined
  const { label, staleDays } = COMMODITIES[commodity]

  if (lookbacks === undefined || isStale(lookbacks.latest.day, utcDayOf(request.now), staleDays)) {
    return undefined
  }

  const { latest, quarterAgo, yearAgo } = lookbacks
  const text = [
    `${label}: ${formatFigure(latest.value)} on ${latest.day}`,
    ...(quarterAgo === undefined
      ? []
      : [`${formatChange(quarterAgo.value, latest.value)} over three months`]),
    ...(yearAgo === undefined ? [] : [`${formatChange(yearAgo.value, latest.value)} over a year`]),
  ].join('; ')

  return { kind: 'commodity', origin: commodity, text, day: latest.day }
}

export async function readCommodities(
  deps: EvidenceDeps,
  request: EvidenceRequest
): Promise<EvidencePart> {
  const drafts = await mapWithConcurrency(COMMODITY_IDS, COMMODITY_CONCURRENCY, (commodity) =>
    readCommodity(deps, commodity, request)
  )
  const read = drafts.flatMap((draft) => (draft === undefined ? [] : [draft]))

  return { kind: 'commodity', drafts: read, missing: read.length < COMMODITY_IDS.length }
}

export async function readSectors(
  deps: EvidenceDeps,
  request: EvidenceRequest
): Promise<EvidencePart> {
  const result = await deps.marketData.sectors({
    market: THEME_MARKET,
    now: request.now,
    signal: request.signal,
  })
  const drafts = result.sectors.flatMap((sector): readonly EvidenceDraft[] => {
    const moves = [
      ...(sector.excessReturnShort === undefined
        ? []
        : [`short-term ${formatShare(sector.excessReturnShort)}`]),
      ...(sector.excessReturnLong === undefined
        ? []
        : [`medium-term ${formatShare(sector.excessReturnLong)}`]),
    ]

    return moves.length === 0
      ? []
      : [
          {
            kind: 'sector',
            origin: SECTOR_ORIGIN,
            text: `${sector.sector} sector against VN-Index: ${moves.join(', ')}`,
            day: result.asOf,
          },
        ]
  })

  return { kind: 'sector', drafts, missing: drafts.length === 0 }
}

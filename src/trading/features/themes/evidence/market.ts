import type {
  EvidenceDeps,
  EvidencePart,
  EvidenceRequest,
} from '@/trading/features/themes/evidence/deps'
import type { EvidenceDraft } from '@/trading/features/themes/types'
import type { CommodityId } from '@/trading/kernel/market/commodity'
import { mapWithConcurrency } from '@/core/utils/concurrency'
import {
  formatChange,
  formatFigure,
  formatShare,
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
const COMMODITY_LABELS: Readonly<Record<CommodityId, string>> = Object.freeze({
  BRENT: 'Brent crude oil',
  'NATURAL-GAS': 'US natural gas (Henry Hub)',
  'IRON-ORE': 'Iron ore 62% Fe',
  COPPER: 'Copper (LME)',
  ALUMINIUM: 'Aluminium (LME)',
  RUBBER: 'Natural rubber (Tokyo)',
  SUGAR: 'Raw sugar',
  COFFEE: 'Arabica coffee',
  COAL: 'Australian thermal coal, monthly',
  RICE: 'Thai rice, monthly',
  PORK: 'Pork, monthly',
  STEEL: 'US steel mill products price index, monthly',
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

  if (lookbacks === undefined) {
    return undefined
  }

  const { latest, quarterAgo, yearAgo } = lookbacks
  const text = [
    `${COMMODITY_LABELS[commodity]}: ${formatFigure(latest.value)} on ${latest.day}`,
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

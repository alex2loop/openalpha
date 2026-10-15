import type {
  ChainContext,
  RatioMedian,
  SectorValuation,
} from '@/trading/features/themes/chain/context'
import type { TrailingSums } from '@/trading/features/themes/chain/quarters'
import type {
  EvidenceDraft,
  EvidenceItem,
  SectorFigures,
  ThemeSector,
} from '@/trading/features/themes/types'
import type { Ticker } from '@/trading/kernel/instrument'
import type { AccountLines } from '@/trading/kernel/market/annual-accounts'
import { toTrailingSums } from '@/trading/features/themes/chain/quarters'
import { toEvidenceItems } from '@/trading/features/themes/evidence/bundle'
import { formatFigure, formatShare } from '@/trading/features/themes/evidence/series'
import { isBankLines } from '@/trading/kernel/market/annual-accounts'
import { ICB_SUPERSECTORS } from '@/trading/kernel/market/market-data'

const MINIMUM_SECTOR_NAMES = 3

/** One growth line and one valuation line per sector, cited as A and V items. */
export function buildSectorFacts(context: ChainContext): readonly EvidenceItem[] {
  const growth = ICB_SUPERSECTORS.flatMap((sector) => toGrowthDraft(sector, context))
  const valuation = ICB_SUPERSECTORS.flatMap((sector) => {
    const reading = context.sectorValuations.get(sector)

    return reading === undefined ? [] : toSectorValuationDraft(sector, reading)
  })

  return [
    ...toEvidenceItems({ kind: 'accounts', drafts: growth }),
    ...toEvidenceItems({ kind: 'valuation', drafts: valuation }),
  ]
}

/** Each line counts its own filers, since a name can file revenue without a profit line. */
function toGrowthDraft(sector: ThemeSector, context: ChainContext): readonly EvidenceDraft[] {
  const members = membersOf(sector, context)
  const moves = [
    toSectorMove('revenue', sumsOf(members, context, revenueOf)),
    toSectorMove('net profit', sumsOf(members, context, profitOf)),
  ].flatMap((move) => move ?? [])

  return moves.length === 0
    ? []
    : [
        {
          kind: 'accounts',
          origin: `sector-accounts:${sector}`,
          text: `${sector}: last four reported quarters against the four before, ${moves.join(', ')}`,
          day: context.day,
        },
      ]
}

function sumsOf(
  members: readonly Ticker[],
  context: ChainContext,
  line: (lines: AccountLines) => number | undefined
): readonly TrailingSums[] {
  return members.flatMap(
    (ticker) =>
      toTrailingSums(context.quarters.get(ticker) ?? [], { asOf: context.day, line }) ?? []
  )
}

function toSectorMove(label: string, sums: readonly TrailingSums[]): string | undefined {
  const growth = toSectorGrowth(sums)

  return growth === undefined
    ? undefined
    : `${label} ${formatShare(growth)} (${sums.length} filers)`
}

/** What a sector read is scored on, for every sector at once. */
export function buildSectorFigures(context: ChainContext): ReadonlyMap<ThemeSector, SectorFigures> {
  return new Map(ICB_SUPERSECTORS.map((sector) => [sector, toSectorFigures(sector, context)]))
}

function toSectorFigures(sector: ThemeSector, context: ChainContext): SectorFigures {
  const profitGrowth = toSectorGrowth(sumsOf(membersOf(sector, context), context, profitOf))
  const earnings = context.sectorValuations.get(sector)?.earnings
  const average = earnings?.average5y

  return {
    ...(profitGrowth === undefined ? {} : { profitGrowth }),
    ...(earnings === undefined || average === undefined || average <= 0
      ? {}
      : { peToAverage: earnings.median / average }),
  }
}

/** The provider's five-year averages are means, and a trough year's spike lifts a mean P/E, so the
 *  line names them as averages and never as a range. Each ratio counts the names that publish it:
 *  a loss-making name has a P/B and no P/E. */
export function toSectorValuationDraft(
  sector: ThemeSector,
  reading: SectorValuation
): readonly EvidenceDraft[] {
  const lines = [
    ...(reading.earnings === undefined ? [] : [toRatioLine('P/E', reading.earnings)]),
    ...(reading.book === undefined ? [] : [toRatioLine('P/B', reading.book)]),
  ]

  return [
    {
      kind: 'valuation',
      origin: `sector-valuation:${sector}`,
      text: `${sector}: ${lines.join('; ')}`,
      day: reading.day,
    },
  ]
}

function toRatioLine(label: string, ratio: RatioMedian): string {
  const average =
    ratio.average5y === undefined
      ? ''
      : ` against a five-year average of ${formatFigure(ratio.average5y)}`

  return `median ${label} ${formatFigure(ratio.median)}${average} (${ratio.names} names)`
}

function membersOf(sector: ThemeSector, context: ChainContext): readonly Ticker[] {
  return [...context.sectorOf].flatMap(([ticker, entry]) => (entry === sector ? [ticker] : []))
}

/** Fewer filers than the minimum and a sum is one company's story, not the sector's. */
function toSectorGrowth(sums: readonly TrailingSums[]): number | undefined {
  if (sums.length < MINIMUM_SECTOR_NAMES) {
    return undefined
  }

  const latest = sums.reduce((total, entry) => total + entry.latest, 0)
  const prior = sums.reduce((total, entry) => total + entry.prior, 0)

  return prior > 0 ? latest / prior - 1 : undefined
}

function profitOf(lines: AccountLines): number | undefined {
  return lines.netProfitToParent
}

/** A bank's payload zero-fills net revenue, so its total operating income is its revenue. */
function revenueOf(lines: AccountLines): number | undefined {
  return isBankLines(lines) ? lines.operatingIncome : lines.netRevenue
}

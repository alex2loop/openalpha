import type { PartScale } from '@/trading/features/themes/score/compose'
import type {
  EvidenceItem,
  ScenarioCase,
  ScorePart,
  SectorLinkage,
  SectorRead,
  StockRead,
  ThemeBundle,
  ThemeClaim,
  ThemeRead,
  ThemeRunReads,
  ThemeScore,
} from '@/trading/features/themes/types'
import {
  MAXIMUM_RATING,
  MAXIMUM_SECTORS,
  MINIMUM_RATING,
} from '@/trading/features/themes/analyst/schemas'
import { isCrowdingDecided } from '@/trading/features/themes/chain/company-facts'
import {
  indexEvidence,
  isFigureId,
  isHardEvidence,
} from '@/trading/features/themes/evidence/bundle'
import {
  buildScore,
  meanOf,
  SCORE_SCALE,
  toPartValue,
} from '@/trading/features/themes/score/compose'
import { SCENARIO_CASES } from '@/trading/features/themes/types'

const PERCENT = 100
const YEAR_MONTHS = 12
const LINK_STRENGTH: Readonly<Record<SectorLinkage, number>> = Object.freeze({
  direct: 1,
  indirect: 0.5,
})
/** Two years out is as durable as the scale reads; a longer horizon adds nothing. */
const DURATION_FULL_MONTHS = 24
/** Three hard figures and four independent origins behind the supporting claims is full marks. */
const EVIDENCE_FULL_HARD = 3
const EVIDENCE_FULL_ORIGINS = 4
const QUALITY_SCALE: PartScale = Object.freeze({ zeroAt: -1, fullAt: 1 })
const PROFIT_GROWTH_SCALE: PartScale = Object.freeze({ zeroAt: -0.2, fullAt: 0.3 })
/** Median P/E against its five-year average: 30% above reads as dear, 30% below as cheap. */
const PE_TO_AVERAGE_SCALE: PartScale = Object.freeze({ zeroAt: 1.3, fullAt: 0.7 })
/** Annualised, so base-case EPS growth and the odds-weighted return read on one scale. */
const GROWTH_SCALE: PartScale = Object.freeze({ zeroAt: -0.1, fullAt: 0.3 })
/** Standard deviations from the name's usual year-on-year change. */
const SURPRISE_SCALE: PartScale = Object.freeze({ zeroAt: -2, fullAt: 2 })
/** The bear case's return times its odds: an expected 15% hit from it scores nothing. */
const BEAR_SCALE: PartScale = Object.freeze({ zeroAt: -0.15, fullAt: 0 })

/** The sector and company steps run only for a theme the operator tracks, so a proposal is read on
 *  its own case alone. */
const PROPOSAL_PARTS: readonly ScorePart[] = Object.freeze(['probability', 'duration', 'evidence'])

type EvidenceIndex = ReadonlyMap<string, EvidenceItem>
type ScenarioReturns = Readonly<Record<ScenarioCase, number>>
type StockScenario = StockRead['scenarios'][ScenarioCase]

/** Theme first, then sector, then stock: a sector's linkage reads its theme's score and a name's
 *  context reads its sector's, while every other part reads only the run's own data. */
export function toScoredReads(reads: ThemeRunReads, bundle: ThemeBundle): ThemeRunReads {
  const index = indexEvidence(bundle.items)
  const themes = reads.themes.map((read) => withScore(read, toThemeScore(read, { index, reads })))
  const sectors = reads.sectors.map((read) =>
    withScore(read, toSectorScore(read, { themes, stocks: reads.stocks }))
  )
  const stocks = reads.stocks.map((read) => withScore(read, toStockScore(read, sectors)))

  return { themes, sectors, stocks }
}

/** Over the read's horizon, a fraction. */
export function toExpectedReturn(read: Pick<StockRead, 'pe' | 'scenarios'>): number | undefined {
  const returns = toScenarioReturns(read)

  return returns === undefined ? undefined : weightByOdds(read, returns)
}

/** The scenarios' returns from today's P/E: EPS grows by the case's growth over the read's horizon
 *  and the market pays the case's target P/E for it. None without a P/E to start from. */
function toScenarioReturns(read: Pick<StockRead, 'pe' | 'scenarios'>): ScenarioReturns | undefined {
  const { pe } = read

  if (pe === undefined) {
    return undefined
  }

  return {
    bull: toCaseReturn(read.scenarios.bull, pe),
    base: toCaseReturn(read.scenarios.base, pe),
    bear: toCaseReturn(read.scenarios.bear, pe),
  }
}

function withScore<T extends { readonly score?: ThemeScore }>(
  read: T,
  score: ThemeScore | undefined
): T {
  return score === undefined ? read : { ...read, score }
}

/** A theme whose own condition was met is no opportunity, so it is never scored. */
function toThemeScore(
  read: ThemeRead,
  input: { readonly index: EvidenceIndex; readonly reads: ThemeRunReads }
): ThemeScore | undefined {
  if (read.status === 'invalidated') {
    return undefined
  }

  const opportunity = toOpportunity(
    input.reads.sectors.filter((sector) => sector.themeId === read.themeId)
  )
  const crowding = toUncrowded(input.reads.stocks.filter((stock) => stock.themeId === read.themeId))

  return buildScore('theme', {
    parts: {
      probability: read.probabilityPct / PERCENT,
      duration: Math.min(read.horizonMonths / DURATION_FULL_MONTHS, 1),
      evidence: toEvidenceQuality(read.supporting, input.index),
      ...(opportunity === undefined ? {} : { opportunity }),
      ...(crowding === undefined ? {} : { crowding }),
    },
    citedFigures: countFigures(read.supporting),
    ...(read.status === 'proposed' ? { applicable: PROPOSAL_PARTS } : {}),
  })
}

/** How broadly the theme reaches: the sectors it helps, weighted by how direct the link is, against
 *  the most the sector step may name. None when no sector was read. */
function toOpportunity(sectors: readonly SectorRead[]): number | undefined {
  if (sectors.length === 0) {
    return undefined
  }

  const reach = sectors
    .filter((sector) => sector.effect === 'benefits')
    .reduce((total, sector) => total + LINK_STRENGTH[sector.linkage], 0)

  return Math.min(reach / MAXIMUM_SECTORS, 1)
}

/** Hard figures and independent origins behind the supporting claims. */
function toEvidenceQuality(claims: readonly ThemeClaim[], index: EvidenceIndex): number {
  const items = citedIds(claims).flatMap((id) => index.get(id) ?? [])
  const hard = items.filter((item) => isHardEvidence(item)).length
  const origins = new Set(items.map((item) => item.origin)).size

  return meanOf([
    Math.min(hard / EVIDENCE_FULL_HARD, 1),
    Math.min(origins / EVIDENCE_FULL_ORIGINS, 1),
  ])
}

/** A sector the theme hurts is not an opportunity, so it is never scored. */
function toSectorScore(
  read: SectorRead,
  input: { readonly themes: readonly ThemeRead[]; readonly stocks: readonly StockRead[] }
): ThemeScore | undefined {
  if (read.effect === 'hurt') {
    return undefined
  }

  const theme = input.themes.find((entry) => entry.themeId === read.themeId)?.score
  const crowding = toUncrowded(
    input.stocks.filter((stock) => stock.themeId === read.themeId && stock.sector === read.sector)
  )
  const { profitGrowth, peToAverage } = read.figures

  return buildScore('sector', {
    parts: {
      criteria: toCriteria(read.criteria),
      ...(theme === undefined
        ? {}
        : { linkage: (LINK_STRENGTH[read.linkage] * theme.value) / SCORE_SCALE }),
      ...(profitGrowth === undefined
        ? {}
        : { growth: toPartValue(profitGrowth, PROFIT_GROWTH_SCALE) }),
      ...(peToAverage === undefined
        ? {}
        : { valuation: toPartValue(peToAverage, PE_TO_AVERAGE_SCALE) }),
      ...(crowding === undefined ? {} : { crowding }),
    },
    citedFigures: countFigures(read.supporting),
  })
}

function toCriteria(criteria: SectorRead['criteria']): number {
  return meanOf(
    Object.values(criteria).map(
      (rating) => (rating - MINIMUM_RATING) / (MAXIMUM_RATING - MINIMUM_RATING)
    )
  )
}

function toStockScore(read: StockRead, sectors: readonly SectorRead[]): ThemeScore | undefined {
  const context = sectors.find(
    (sector) => sector.themeId === read.themeId && sector.sector === read.sector
  )?.score
  const returns = toScenarioReturns(read)
  const valuation = toValuationPart(read, returns)

  return buildScore('stock', {
    parts: {
      exposure: read.exposure.label === 'negative' ? 0 : read.exposure.blendedPct / PERCENT,
      earnings: toEarningsPart(read),
      quality: toPartValue(read.quality, QUALITY_SCALE),
      ...(context === undefined ? {} : { context: context.value / SCORE_SCALE }),
      ...(valuation === undefined ? {} : { valuation }),
      ...(returns === undefined ? {} : { risk: toRiskPart(read, returns) }),
    },
    citedFigures: countFigures([...read.exposureBasis, ...read.chain, read.pricedIn]),
  })
}

/** Base-case EPS growth, annualised, beside the latest quarter's surprise where it was read. */
function toEarningsPart(read: StockRead): number {
  const growth = toAnnualRate(read.scenarios.base.epsGrowthPct / PERCENT, read.horizonMonths)
  const surprise = read.surprise?.standardized

  return meanOf([
    toPartValue(growth, GROWTH_SCALE),
    ...(surprise === undefined ? [] : [toPartValue(surprise, SURPRISE_SCALE)]),
  ])
}

/** The odds-weighted return, annualised, beside where today's P/E sits in its own five years. */
function toValuationPart(
  read: StockRead,
  returns: ScenarioReturns | undefined
): number | undefined {
  const percentile = read.crowding.pePercentile
  const values = [
    ...(returns === undefined
      ? []
      : [toPartValue(toAnnualRate(weightByOdds(read, returns), read.horizonMonths), GROWTH_SCALE)]),
    ...(percentile === undefined ? [] : [1 - percentile / PERCENT]),
  ]

  return values.length === 0 ? undefined : meanOf(values)
}

/** Liquidity is a board gate every shortlisted name cleared and the balance sheet sits in the
 *  quality factor, so the risk part reads the bear case alone. */
function toRiskPart(read: StockRead, returns: ScenarioReturns): number {
  return toPartValue((returns.bear * read.scenarios.bear.probabilityPct) / PERCENT, BEAR_SCALE)
}

/** The share of the names whose crowding was decided that are not crowded. A name whose signals
 *  could not be read is neither: it drops out, and none decided means no part. */
function toUncrowded(stocks: readonly StockRead[]): number | undefined {
  const decided = stocks.filter((stock) => isCrowdingDecided(stock.crowding))

  return decided.length === 0
    ? undefined
    : 1 - decided.filter((stock) => stock.crowding.crowded).length / decided.length
}

function toCaseReturn(scenario: StockScenario, pe: number): number {
  return ((1 + scenario.epsGrowthPct / PERCENT) * scenario.targetPe) / pe - 1
}

function weightByOdds(read: Pick<StockRead, 'scenarios'>, returns: ScenarioReturns): number {
  return SCENARIO_CASES.reduce(
    (total, key) => total + (read.scenarios[key].probabilityPct / PERCENT) * returns[key],
    0
  )
}

function toAnnualRate(total: number, months: number): number {
  return (1 + total) ** (YEAR_MONTHS / months) - 1
}

/** Only the claims the score's case rests on: counter claims and risks are required on every read,
 *  so a figure cited against it never makes the case more solid. */
function countFigures(claims: readonly ThemeClaim[]): number {
  return citedIds(claims).filter(isFigureId).length
}

function citedIds(claims: readonly ThemeClaim[]): readonly string[] {
  return [...new Set(claims.flatMap((claim) => claim.evidence))]
}

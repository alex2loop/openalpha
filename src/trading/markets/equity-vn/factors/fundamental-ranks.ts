import type { FactorMetric, FactorMetricId } from '@/trading/kernel/factor-metric'
import type { Ticker } from '@/trading/kernel/instrument'
import type { FundamentalSnapshot } from '@/trading/kernel/market/market-data'
import type { RankComponent } from '@/trading/markets/equity-vn/factors/fundamental-components'
import { ratioOf } from '@/trading/markets/equity-vn/accounts/lines'
import {
  QUALITY_COMPONENTS,
  VALUE_COMPONENTS,
} from '@/trading/markets/equity-vn/factors/fundamental-components'
import { SECTOR_RANK_MINIMUM_MEMBERS } from '@/trading/markets/equity-vn/policy'
import { rankWithin } from '@/trading/markets/factor-scoring'
import { median } from '@/trading/markets/timeseries'

/** The one field every percentile needs: which name a rank belongs to. */
interface Ranked {
  readonly record: { readonly instrument: { readonly ticker: Ticker } }
}

/** A stored rank runs 0 to 1; the operator reads it as a percentile out of a hundred. */
const PERCENT_SCALE = 100

/** A rank orders a name against others; a population of one has no one to order it against, and
 *  `rankWithin` would hand it a neutral 0,5 that reads as a measured middle. */
const MINIMUM_RANKED_POPULATION = 2

/** What ranking reads of a name, declared here rather than imported: the evidence type lives with
 *  the factors that consume these percentiles, and importing it back would close a cycle. */
interface RankableName {
  readonly record: {
    readonly instrument: { readonly ticker: Ticker }
    readonly sector?: string
  }
  readonly fundamental: FundamentalSnapshot | null
  readonly closes: readonly number[]
  /** A year of average daily traded value. Ranked against the company's own capitalisation, never
   *  on its own: đồng traded is mostly a restatement of size, while the share of the company that
   *  changed hands is the speculation the published factor measures. */
  readonly annualTurnover?: number
  /** Clears every screen gate, which is the population the published ranks are measured over. */
  readonly screened: boolean
}

export function qualityPercentiles(names: readonly RankableName[]): ReadonlyMap<Ticker, number> {
  return boardRanks(names, compositeRank(names, QUALITY_COMPONENTS))
}

export function valuePercentiles(names: readonly RankableName[]): ReadonlyMap<Ticker, number> {
  return boardRanks(names, compositeRank(names, VALUE_COMPONENTS))
}

/** Ranked inside size groups rather than across the whole board. The published VN turnover leg
 *  carries its premium only under a size-neutral sort: capitalisation and turnover rate run
 *  strongly opposite among names that cleared a đồng-turnover gate, so an unconditional rank spends
 *  itself restating `size` with the sign flipped and the two legs cancel. */
export function speculativeTurnoverPercentiles(
  names: readonly RankableName[]
): ReadonlyMap<Ticker, number> {
  const rates = turnoverRates(names)

  return new Map(sizeGroups(names).flatMap((group) => [...boardRanks(group, rates)]))
}

/** The board halved at the median capitalisation of the names a rank is measured against, which is
 *  the split the published model sorts on. A name with no capitalisation joins neither half rather
 *  than defaulting into the smaller one — it has no turnover rate to rank either way, and a missing
 *  figure standing in for the smallest is how an absent reading becomes a score. An unmeasurable
 *  median leaves the board whole rather than splitting it arbitrarily. */
function sizeGroups(names: readonly RankableName[]): readonly (readonly RankableName[])[] {
  const split = median(
    rankedPopulation(names)
      .map(positiveMarketCap)
      .filter((cap): cap is number => cap !== undefined)
  )

  if (split === undefined) {
    return [names]
  }

  const larger: RankableName[] = []
  const smaller: RankableName[] = []

  for (const name of names) {
    const cap = positiveMarketCap(name)

    if (cap === undefined) {
      continue
    }

    if (cap >= split) {
      larger.push(name)
    } else {
      smaller.push(name)
    }
  }

  return [larger, smaller]
}

/** How much of the company changes hands in a day, as traded value over capitalisation. The share
 *  count the published factor divides by is recoverable, and the two rank this board 0,975 alike,
 *  so the extra field buys nothing: the price in each leg cancels only approximately, since the
 *  numerator averages a year of prices and the denominator carries today's. A name with no
 *  capitalisation, or no turnover reading, is unmeasured rather than measured at zero. */
function turnoverRates(names: readonly RankableName[]): ReadonlyMap<Ticker, number> {
  const rates = new Map<Ticker, number>()

  for (const name of names) {
    const marketCap = positiveMarketCap(name)

    if (marketCap !== undefined && name.annualTurnover !== undefined) {
      rates.set(name.record.instrument.ticker, name.annualTurnover / marketCap)
    }
  }

  return rates
}

/** A name's standing on the board an operator can actually buy. Ranked over the whole stored
 *  universe instead, every survivor lands in one corner of the scale, because the gates admit one
 *  end of it: the board turns over four times what the rest of the market does, which read as a
 *  bearish tilt no factor intended. A rejected name is placed on that same population rather than
 *  dropped, so asking about one by ticker answers against the board it would be bought alongside. */
function boardRanks(
  names: readonly RankableName[],
  values: ReadonlyMap<Ticker, number>
): ReadonlyMap<Ticker, number> {
  const population = rankPopulation(names, values)
  const ranked = new Map<Ticker, number>()

  if (population.length < MINIMUM_RANKED_POPULATION) {
    return ranked
  }

  for (const name of names) {
    const key = name.record.instrument.ticker
    const value = values.get(key)

    if (value !== undefined) {
      ranked.set(key, rankWithin(population, value))
    }
  }

  return ranked
}

/** The values the screened board produced, sorted. */
function rankPopulation(
  names: readonly RankableName[],
  values: ReadonlyMap<Ticker, number>
): readonly number[] {
  return rankedPopulation(names)
    .map((name) => values.get(name.record.instrument.ticker))
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right)
}

/** The names a rank is measured against: the board an operator can actually buy. Falls back to
 *  every measured name when no candidate cleared the gates, which would otherwise flatten the
 *  factor to a neutral 0,5. */
function rankedPopulation(names: readonly RankableName[]): readonly RankableName[] {
  const screened = names.filter((name) => name.screened)

  return screened.length === 0 ? names : screened
}

/** Capitalisation where it is a usable number. Absent rather than zero: a name the fundamentals
 *  refresh has not reached is unmeasured, not small. */
function positiveMarketCap(name: RankableName): number | undefined {
  const marketCap = name.fundamental?.marketCap

  return marketCap === undefined || marketCap <= 0 ? undefined : marketCap
}

/** A fundamental is only usable with the close it is priced against: three of the eight components
 *  are yields, and an unpriced name has no yield rather than a zero one. */
function pricedSnapshot(
  evidence: RankableName
): { snapshot: FundamentalSnapshot; close: number } | null {
  const snapshot = evidence.fundamental
  const close = evidence.closes[evidence.closes.length - 1]

  return snapshot === null || close === undefined || close <= 0 ? null : { snapshot, close }
}

/** Each component is ranked across the population before the average is taken, so a name missing
 *  one is not lifted or dragged by its absence — a raw average over whichever components survive
 *  reads a missing leverage term as a name without debt. Ranking also removes the scale mismatch
 *  between a percentage and a bare ratio, so no component needs a hand-tuned scale.
 *
 *  A name with no component at all abstains rather than ranking last: unknown is not bad. */
function compositeRank(
  names: readonly RankableName[],
  components: readonly RankComponent[]
): ReadonlyMap<Ticker, number> {
  const ranked = components.map((component) =>
    sectorPercentiles(names, (evidence) => {
      const priced = pricedSnapshot(evidence)

      return priced === null ? undefined : component.select(priced.snapshot, priced.close)
    })
  )
  const composite = new Map<Ticker, number>()

  for (const name of names) {
    const key = name.record.instrument.ticker
    const value = weightedRank(ranked, components, key)

    if (value !== undefined) {
      composite.set(key, value)
    }
  }

  return composite
}

/** The fold over whichever components this name produced, renormalized by the weight actually
 *  present — so a name missing its leverage term is not scored as though that term were zero. */
function weightedRank(
  ranked: readonly ReadonlyMap<Ticker, number>[],
  components: readonly RankComponent[],
  key: Ticker
): number | undefined {
  let weighted = 0
  let present = 0

  for (const [index, component] of components.entries()) {
    const value = ranked[index]?.get(key)

    if (value !== undefined) {
      weighted += value * component.weight
      present += component.weight
    }
  }

  return present === 0 ? undefined : weighted / present
}

/** Ranked against sector peers, because every component these compose is sector-conditioned: a
 *  bank carries no cost of goods, prices at a fraction of an industrial's book, and earns on assets
 *  an order of magnitude larger. Ranked market-wide, the sector decides the score before the
 *  business does. Momentum and relative strength keep ranking market-wide — a move is a move
 *  whoever makes it, and neutralising it is what the evidence argues against.
 *
 *  Sectors too thin to rank within pool together rather than each ranking against a handful, which
 *  would make a three-name sector's median look like a market-wide leader. */
function sectorPercentiles(
  names: readonly RankableName[],
  selectValue: (evidence: RankableName) => number | undefined
): ReadonlyMap<Ticker, number> {
  return new Map(rankingGroups(names).flatMap((group) => [...percentiles(group, selectValue)]))
}

/** How many names the published ranks were measured against: a rank over eight peers and one over
 *  eighty are not the same claim, and the percentile alone cannot tell them apart. A priced
 *  snapshot is what both composites need, so requiring one also drops the funds that file none. */
export function rankedPeerCount(names: readonly RankableName[]): number {
  return rankedPopulation(names.filter((name) => pricedSnapshot(name) !== null)).length
}

/** A sector large enough to rank within is its own pool; everything else ranks against the rest of
 *  the market together, since a percentile over two names says nothing. */
function rankingGroups(names: readonly RankableName[]): readonly (readonly RankableName[])[] {
  const bySector = new Map<string, RankableName[]>()

  for (const name of names) {
    const sector = name.record.sector ?? ''
    const group = bySector.get(sector)

    if (group === undefined) {
      bySector.set(sector, [name])
    } else {
      group.push(name)
    }
  }

  const pooled: RankableName[] = []
  const groups: (readonly RankableName[])[] = []

  for (const [sector, group] of bySector) {
    if (sector !== '' && group.length >= SECTOR_RANK_MINIMUM_MEMBERS) {
      groups.push(group)
    } else {
      pooled.push(...group)
    }
  }

  return [...groups, pooled]
}

/** The sector-neutral input a published rank is built from, never a published rank itself, so it
 *  spans every name that produced a value: a sector's ordering must not move as gates admit and
 *  reject its members. A name that produced none is absent rather than ranked last. */
function percentiles<T extends Ranked>(
  names: readonly T[],
  selectValue: (evidence: T) => number | undefined
): ReadonlyMap<Ticker, number> {
  const present: { readonly ticker: Ticker; readonly value: number }[] = []

  for (const name of names) {
    const value = selectValue(name)

    if (value !== undefined && Number.isFinite(value)) {
      present.push({ ticker: name.record.instrument.ticker, value })
    }
  }

  if (present.length < MINIMUM_RANKED_POPULATION) {
    return new Map()
  }

  const population = present.map((entry) => entry.value).sort((left, right) => left - right)

  return new Map(present.map((entry) => [entry.ticker, rankWithin(population, entry.value)]))
}

/** The multiples and growth the ranked yields were built from, priced against the same close, plus
 *  the sector rank the score actually is. A negative or absent earnings line has no multiple to
 *  state, which is why the factor ranks yields rather than ratios in the first place. */
export function valuationMetrics(
  evidence: RankableName,
  percentile: number | undefined,
  peers: number | undefined
): readonly FactorMetric[] {
  const snapshot = evidence.fundamental
  const close = evidence.closes[evidence.closes.length - 1]

  if (snapshot === null || close === undefined || close <= 0) {
    return rankMetrics('value-percentile', percentile, peers)
  }

  return [
    ...multiple('pe', close, snapshot.earningsPerShare),
    ...multiple('pb', close, snapshot.bookValuePerShare),
    ...measure('earnings-growth', snapshot.earningsGrowthYoyPct),
    ...rankMetrics('value-percentile', percentile, peers),
  ]
}

/** Priced against the same close and share count as the P/E beside it. */
export function averageProfitMetrics(
  evidence: RankableName,
  averageProfit: number | undefined
): readonly FactorMetric[] {
  const close = evidence.closes[evidence.closes.length - 1]
  const perShare = ratioOf(averageProfit, evidence.fundamental?.sharesOutstanding)

  return close === undefined || close <= 0 ? [] : multiple('average-profit-pe', close, perShare)
}

export function qualityMetrics(
  evidence: RankableName,
  percentile: number | undefined,
  peers: number | undefined
): readonly FactorMetric[] {
  const snapshot = evidence.fundamental

  return [
    ...measure('revenue-growth', snapshot?.revenueGrowthYoyPct),
    ...measure('return-on-equity', snapshot?.returnOnEquityPct),
    ...measure('return-on-assets', snapshot?.returnOnAssetsPct),
    ...measure('debt-to-equity', snapshot?.debtToEquity),
    ...measure('gross-margin', snapshot?.grossMarginPct),
    ...rankMetrics('quality-percentile', percentile, peers),
  ]
}

/** Which composite a published rank belongs to. Typed against the metric union, so a factor cannot
 *  publish a rank under an id the catalogs do not label. */
type RankId = Extract<FactorMetricId, 'quality-percentile' | 'value-percentile'>

/** The rank is what the score is, so it travels even when no filing line survived. The peer count
 *  travels with it and never alone: a population size beside no rank measures nothing.
 *
 *  Each composite carries its own id. Quality and value rank the same name against the same peers
 *  and land on different percentiles, so one shared id let a surface that folds a candidate's
 *  metrics by id keep whichever factor it read last — MBB printed p54 on a board while its quality
 *  rank was p85, with nothing saying which of the two the number was. */
function rankMetrics(
  id: RankId,
  percentile: number | undefined,
  peers: number | undefined
): readonly FactorMetric[] {
  const rank = measure(id, percentile, PERCENT_SCALE)

  return rank.length === 0 ? rank : [...rank, ...measure('ranked-peers', peers)]
}

function multiple(
  id: FactorMetricId,
  close: number,
  perShare: number | undefined
): readonly FactorMetric[] {
  return perShare === undefined || perShare <= 0 ? [] : [{ id, value: close / perShare }]
}

function measure(
  id: FactorMetricId,
  value: number | undefined,
  scale = 1
): readonly FactorMetric[] {
  return value === undefined || !Number.isFinite(value) ? [] : [{ id, value: value * scale }]
}

import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import type {
  FactorAttribution,
  FactorAttributionBucket,
  FactorId,
  FactorReading,
} from '@/trading/kernel/factor'
import type { MarketRef } from '@/trading/kernel/instrument'
import { FACTOR_READINGS } from '@/trading/kernel/factor'

/** A score this close to zero is the factor abstaining in all but name, and bucketing it either way
 *  would put a non-opinion on one side of the ledger. */
const NEUTRAL_SCORE_AT = 0.01

/** Neither a market ref nor a strategy version contains a space, so the joined key splits
 *  unambiguously. The group carries
 *  both values as fields anyway; the key only has to be unique. */
const KEY_SEPARATOR = ' '

/** Starts a market's level-key fingerprint: `1.0.0+3f9a1c0b`. */
const VERSION_SUFFIX_SEPARATOR = '+'

interface ScoredOutcome {
  readonly score: number
  /** What holding the name long returned beyond the baseline. */
  readonly excessReturnPct: number
}

/** What an attribution row is scored from: the factors as they read, and what holding the name long
 *  returned after, against a baseline over the same span. A factor reads the price, not the call, so
 *  a reduce is scored from the long side too. Fractions despite the name, like every return in the
 *  tree. */
export interface ScoredRow {
  readonly market: MarketRef
  readonly strategyVersion: string
  readonly factorScores: readonly {
    readonly id: FactorId
    readonly score: number
    readonly weight?: number
  }[]
  /** The long side's price move, before fees: a factor predicts the price, and the baseline is gross. */
  readonly longReturnPct: number
  /** What the market returned over the same span, long side: a falling tape makes every bearish
   *  reading look right against zero, so a factor is judged by what it beat. Absent when none was
   *  measured, and an absent baseline is not zero: the row is left out of the record. */
  readonly baselineReturnPct?: number
}

interface FactorGroup {
  readonly market: MarketRef
  readonly strategyVersion: string
  readonly factorId: FactorId
  readonly scored: ScoredOutcome[]
  /** From the newest row that carried one. Rows arrive newest-first, so the first wins. */
  weight?: number
}

/** `rows` arrive newest-first from the store, which is what makes the first weight seen the current
 *  one. */
export function summarizeFactorAttribution(
  rows: readonly ScoredRow[],
  minimumSampleSize: number
): readonly FactorAttribution[] {
  const grouped = groupByFactor(rows)
  const firstSeen = new Map<string, number>()

  return [...grouped.values()]
    .map((group) => ({
      attribution: toAttribution(group, minimumSampleSize),
      recency: recencyOf(firstSeen, group),
    }))
    .toSorted(byVersionRecency)
    .map((entry) => entry.attribution)
}

function groupByFactor(rows: readonly ScoredRow[]): ReadonlyMap<string, FactorGroup> {
  const grouped = new Map<string, FactorGroup>()

  for (const row of rows) {
    if (row.baselineReturnPct === undefined) {
      continue
    }

    const excessReturnPct = row.longReturnPct - row.baselineReturnPct

    for (const factor of row.factorScores) {
      const { market } = row
      const key = [market, row.strategyVersion, factor.id].join(KEY_SEPARATOR)
      const group = grouped.get(key) ?? {
        market,
        strategyVersion: row.strategyVersion,
        factorId: factor.id,
        scored: [],
      }

      group.scored.push({ score: factor.score, excessReturnPct })

      if (group.weight === undefined && factor.weight !== undefined) {
        group.weight = factor.weight
      }

      grouped.set(key, group)
    }
  }

  return grouped
}

/** Position of a group's version among its market's versions, newest first. A level-key suffix is a
 *  hash, so only the order the newest-first rows first showed a version tells which is live. */
function recencyOf(firstSeen: Map<string, number>, group: FactorGroup): number {
  const key = `${group.market}${KEY_SEPARATOR}${group.strategyVersion}`
  const seen = firstSeen.get(key) ?? firstSeen.size

  firstSeen.set(key, seen)

  return seen
}

interface RankedAttribution {
  readonly attribution: FactorAttribution
  readonly recency: number
}

/** The part before `+` is the code version and orders numerically; versions that differ only by a
 *  level-key suffix order by which showed up newest. */
function byVersionRecency(left: RankedAttribution, right: RankedAttribution): number {
  const a = left.attribution
  const b = right.attribution

  return (
    a.market.localeCompare(b.market) ||
    baseVersionOf(b.strategyVersion).localeCompare(baseVersionOf(a.strategyVersion), undefined, {
      numeric: true,
    }) ||
    left.recency - right.recency ||
    a.factorId.localeCompare(b.factorId)
  )
}

function baseVersionOf(version: string): string {
  return version.split(VERSION_SUFFIX_SEPARATOR)[0] ?? version
}

/** A resolved call as an attribution row. Its return is stored net of the round trip, so the fee is
 *  added back and a reduce turned to the long side: a factor predicts the price, not the fee, and the
 *  board's rows are gross as well. The row does not store its fee, so the caller passes the market's
 *  round-trip rate. A call has too few same-day peers for a session mean, so its baseline is the index
 *  it was scored against. */
export function suggestionScoredRow(
  suggestion: ResolvedActionableSuggestion,
  roundTripFee: number
): ScoredRow {
  const baseline = longSideBenchmark(suggestion)

  return {
    market: suggestion.instrument.market,
    strategyVersion: suggestion.strategyVersion,
    factorScores: suggestion.factorScores,
    longReturnPct: longSideReturn(suggestion, roundTripFee),
    ...(baseline === undefined ? {} : { baselineReturnPct: baseline }),
  }
}

/** The long side's move before fees. A buy is stored as `move - fee` and a reduce as `-move - fee`,
 *  so the fee goes back on a buy and comes off a reduce once more than its negation. */
function longSideReturn(suggestion: ResolvedActionableSuggestion, roundTripFee: number): number {
  const { returnPct } = suggestion.outcome

  return suggestion.action === 'buy' ? returnPct + roundTripFee : -returnPct - roundTripFee
}

/** The index move is stored on the call's own side, so a reduce's is negated back to the long side. */
function longSideBenchmark(suggestion: ResolvedActionableSuggestion): number | undefined {
  const { benchmarkReturnPct } = suggestion.outcome

  if (benchmarkReturnPct === undefined) {
    return undefined
  }

  return suggestion.action === 'buy' ? benchmarkReturnPct : -benchmarkReturnPct
}

function toAttribution(group: FactorGroup, minimumSampleSize: number): FactorAttribution {
  const buckets = FACTOR_READINGS.map((reading) =>
    toBucket(reading, group.scored, minimumSampleSize)
  )
  const thin = buckets.some((bucket) => bucket.resolvedCount < minimumSampleSize)

  return {
    market: group.market,
    factorId: group.factorId,
    strategyVersion: group.strategyVersion,
    firedCount: group.scored.length,
    ...(group.weight === undefined ? {} : { weight: group.weight }),
    buckets,
    caveats: thin
      ? [
          {
            code: 'reporting.sample-below-minimum',
            detail: { count: group.scored.length, minimum: minimumSampleSize },
          },
        ]
      : [],
  }
}

/** Counts always; the rate and the average only once the bucket carries enough rows to mean
 *  something, matching what `summarizeTrackRecord` reports per conviction band. */
function toBucket(
  reading: FactorReading,
  scored: readonly ScoredOutcome[],
  minimumSampleSize: number
): FactorAttributionBucket {
  const members = scored.filter((entry) => readingOf(entry.score) === reading)
  const hits = members.filter((entry) => isHit(reading, entry.excessReturnPct))
  const counts = { reading, resolvedCount: members.length, hitCount: hits.length }

  if (members.length < minimumSampleSize) {
    return counts
  }

  const total = members.reduce((sum, entry) => sum + entry.excessReturnPct, 0)

  return {
    ...counts,
    hitRate: hits.length / members.length,
    meanReturnPct: total / members.length,
  }
}

/** A reading is right when the name beat its baseline on a bullish read and trailed it on a bearish
 *  one; a name that matched the baseline is neither. */
function isHit(reading: FactorReading, excessReturnPct: number): boolean {
  return reading === 'bullish' ? excessReturnPct > 0 : excessReturnPct < 0
}

function readingOf(score: number): FactorReading | undefined {
  if (score > NEUTRAL_SCORE_AT) {
    return 'bullish'
  }

  return score < -NEUTRAL_SCORE_AT ? 'bearish' : undefined
}

import type { Caveat } from '@/trading/kernel/caveat'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type {
  FactorComposite,
  FactorId,
  FactorNormalization,
  FactorPolicy,
  FactorResult,
  FactorScore,
} from '@/trading/kernel/factor'
import type { FactorMetric } from '@/trading/kernel/factor-metric'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { ValidationError } from '@/core/errors'
import { EXTREME_SCORE_AT, MILD_SCORE_AT } from '@/trading/kernel/conviction'

export const FACTOR_SCORING_VERSION = '1.0.0'

/** One cross-market scoring floor. A market that needs a different bar overrides it explicitly in
 *  its own policy instead of the same literal drifting apart per market file. Agreement is a share
 *  of scored magnitude, so its floor is an even split at 0.5, not zero — the bar sits above that,
 *  and 0.6 asks the leading side to carry three fifths of what scored. */
export const DEFAULT_MINIMUM_COVERAGE_FRACTION = 0.6
export const DEFAULT_MINIMUM_AGREEMENT = 0.6
/** Coverage is a ratio of summed weights, so three of five equal legs can land a rounding step
 *  either side of 0.6. A ratio exactly at the floor passes on purpose, never by rounding. */
const COVERAGE_TOLERANCE = 1e-9

/** The fallback pair for a market whose composite spread has not been measured yet. Measured on a VN
 *  equity board, so they describe weakly-related factors averaging each other away. Which way
 *  they read elsewhere is not guessable — crypto's factors move together, so its composite runs twice
 *  as wide and needed a higher ceiling, not a lower one. Measure, with
 *  `scripts/research-conviction-bands.ts`, rather than reason from the factor count. */
export const DEFAULT_MEDIUM_CONVICTION_AT = 0.18
export const DEFAULT_HIGH_CONVICTION_AT = 0.32

/** Where the bars for "worth buying" and "bearish enough to refuse a buy" sit relative to the medium
 *  band. Ratios, not levels: the question is whether a read is distinguishable from neutral, and how
 *  far that is moves with each market's own spread — the same reason the bands themselves are
 *  per-market. Between them the composite has no opinion, which is a verdict and not a failure. */
const BULLISH_DRAFT_RATIO = 0.45
const BEARISH_DRAFT_RATIO = 0.45

/** What a name the scorer never reached reads as: no evidence, not weak evidence. Shared so no two
 *  callers describe the same gap differently. */
export const UNSCORED_COMPOSITE: FactorComposite = Object.freeze({
  score: 0,
  band: 'low',
  bearish: false,
  bullish: false,
  coverage: 0,
  coverageBelowMinimum: true,
  agreementBelowMinimum: false,
})

export const RANK_HIGHER_IS_BULLISH: FactorNormalization = Object.freeze({
  kind: 'rank',
  direction: 'higher-is-bullish',
})
export const RANK_LOWER_IS_BULLISH: FactorNormalization = Object.freeze({
  kind: 'rank',
  direction: 'lower-is-bullish',
})

/** A return, scored linearly between two clip bounds with zero as neutral: whatever the envelope's
 *  skew, a name that went nowhere has not leaned either way. */
export function returnBand(bearishAt: number, bullishAt: number): FactorNormalization {
  return Object.freeze({ kind: 'linear', bearishAt, neutralAt: 0, bullishAt })
}

export interface FactorInput<K extends FactorId> {
  readonly id: K
  /** Absent = this factor could not be computed. It abstains; it does not score zero. */
  readonly raw?: number
  /** Inapplicable to this instrument, not missing data: abstains without an input-missing caveat and
   *  without counting against coverage. */
  readonly inapplicable?: boolean
  /** The measured quantities the raw value came from, where they have an operator-facing unit.
   *  Carried through scoring untouched — normalization has no opinion about them. */
  readonly metrics?: readonly FactorMetric[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

interface FactorContribution {
  readonly result: FactorResult
  readonly weight: number
  readonly fired: boolean
  readonly applicable: boolean
}

export function scoreFactors<K extends FactorId>(
  inputs: readonly FactorInput<K>[],
  policy: FactorPolicy<K>
): FactorScore {
  const seen = new Set<K>()
  const contributions = inputs.map((input) => scoreOneFactor(input, policy, seen))

  assertPolicyCovered(seen, policy)

  const fired = contributions.filter((contribution) => contribution.fired)
  const totalWeight = contributions
    .filter((contribution) => contribution.applicable)
    .reduce((sum, contribution) => sum + contribution.weight, 0)
  const firedWeight = fired.reduce((sum, contribution) => sum + contribution.weight, 0)
  // Dividing by fired weight, not total: dividing by total would drag every score toward zero as
  // coverage falls, which reads as "neutral" when the truth is "we do not know". Coverage is
  // reported separately and lowers conviction explicitly.
  const weightedSum = fired.reduce(
    (sum, contribution) => sum + contribution.result.score * contribution.weight,
    0
  )
  const coverage = totalWeight === 0 ? 0 : firedWeight / totalWeight
  const agreement = fired.length >= 2 ? resolveAgreement(fired) : undefined
  const score = firedWeight === 0 ? 0 : weightedSum / firedWeight

  return {
    results: byContribution(contributions, firedWeight),
    score,
    band: bandOf(score, policy),
    bullish: score >= policy.mediumConvictionAt * BULLISH_DRAFT_RATIO,
    bearish: score <= -(policy.mediumConvictionAt * BEARISH_DRAFT_RATIO),
    coverage,
    coverageBelowMinimum: isBelowCoverage(coverage, policy),
    agreementBelowMinimum: agreement !== undefined && agreement < policy.minimumAgreement,
    ...(agreement === undefined ? {} : { agreement }),
    caveats: policyCaveats(agreement, coverage, policy),
  }
}

/** Strength, not direction: a strongly bearish composite is a confident reduce, not a weak buy.
 *  Whoever acts on the band decides what to do with the sign. */
function bandOf<K extends FactorId>(score: number, policy: FactorPolicy<K>): ConvictionBand {
  const strength = Math.abs(score)

  if (strength >= policy.highConvictionAt) {
    return 'high'
  }

  return strength >= policy.mediumConvictionAt ? 'medium' : 'low'
}

/** Most decisive first, where decisive is score times weight rather than score alone: a factor
 *  carrying a twentieth of the composite can hold the extreme value while a factor carrying three
 *  times that moved the ranking. Every reader takes the leading rows — the evidence prompt, the
 *  screen board — so the order is where "which factors explain this" is decided. An abstained
 *  factor contributes nothing and sorts last. */
function byContribution(
  contributions: readonly FactorContribution[],
  firedWeight: number
): readonly FactorResult[] {
  return [...contributions]
    .sort(
      (left, right) =>
        Math.abs(right.result.score) * right.weight - Math.abs(left.result.score) * left.weight
    )
    .map((contribution) => publishedResult(contribution, firedWeight))
}

/** The policy weight is a relative number whose total is whatever the table happens to sum to; the
 *  composite divides by the fired total, so only the quotient is a share anyone can add up. */
function publishedResult(contribution: FactorContribution, firedWeight: number): FactorResult {
  return contribution.fired && firedWeight > 0
    ? { ...contribution.result, weight: contribution.weight / firedWeight }
    : contribution.result
}

/** What "ordinary" reads as on one board, per factor. A factor whose normalization saturates prints
 *  the same score for most of a board; its median is that score, and a row selected against it then
 *  leads with what actually sets the name apart. */
export function boardMedians<K extends FactorId>(
  rows: readonly (readonly FactorResult<K>[])[]
): ReadonlyMap<K, number> {
  const scores = new Map<K, number[]>()

  for (const factors of rows) {
    for (const factor of factors) {
      const collected = scores.get(factor.id) ?? []

      collected.push(factor.score)
      scores.set(factor.id, collected)
    }
  }

  return new Map([...scores].map(([id, values]) => [id, median(values)]))
}

/** Most distinctive first: how far this name's reading sits from the board's. Ties hold the
 *  contribution order they arrived in, which is what a one-name board falls back to. A reading the
 *  composite gives no weight is left out, since it cannot be why the name ranks where it does. */
export function byDistinctiveness<K extends FactorId>(
  factors: readonly FactorResult<K>[],
  medians: ReadonlyMap<K, number>
): readonly FactorResult<K>[] {
  return factors
    .filter((factor) => factor.weight !== 0)
    .sort((left, right) => deviationFrom(medians, right) - deviationFrom(medians, left))
}

function deviationFrom<K extends FactorId>(
  medians: ReadonlyMap<K, number>,
  factor: FactorResult<K>
): number {
  return Math.abs(factor.score - (medians.get(factor.id) ?? 0))
}

/** Only ever called with one factor's collected scores, which is non-empty by construction. */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const upper = sorted[middle] ?? 0

  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + upper) / 2 : upper
}

// Split out of scoreFactors so the aggregation above reads as one paragraph: weight lookup,
// duplicate/unknown rejection, and the missing-versus-normalized branch all belong to a single
// factor and do not need re-reading while scanning how the composite is built.
function scoreOneFactor<K extends FactorId>(
  input: FactorInput<K>,
  policy: FactorPolicy<K>,
  seen: Set<K>
): FactorContribution {
  const weight = policy.weights[input.id]

  if (weight === undefined || seen.has(input.id)) {
    throw new ValidationError(`factor ${String(input.id)} is unknown to the policy or duplicated`)
  }

  seen.add(input.id)

  // A missing input keeps its row — omitting it would make "we could not compute this" look
  // identical to "this factor is not part of the market" — but never joins the fired set.
  const shared = {
    id: input.id,
    ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    provenance: input.provenance,
  }

  if (input.raw === undefined || !Number.isFinite(input.raw)) {
    if (input.inapplicable === true) {
      return {
        weight,
        fired: false,
        applicable: false,
        result: { ...shared, score: 0, caveats: input.caveats },
      }
    }

    return {
      weight,
      fired: false,
      applicable: true,
      result: {
        ...shared,
        score: 0,
        caveats: [...input.caveats, { code: 'factor.input-missing', detail: { factor: input.id } }],
      },
    }
  }

  return {
    weight,
    fired: true,
    applicable: true,
    result: {
      ...shared,
      score: normalizeFactor(input.raw, policy.normalization[input.id]),
      caveats: input.caveats,
    },
  }
}

/** Five verbal buckets over the shared [-1, 1] scale, so an operator reads a word instead of a raw
 *  float. Symmetric around zero, on the same cut points conviction reads as strength. Lives beside
 *  the scale it quantizes (`normalizeFactor`), not in presentation code — evidence derivation reads
 *  bands too, and domain must never import from `render/`. */
export const SCORE_BANDS = Object.freeze([
  'very-bearish',
  'bearish',
  'neutral',
  'bullish',
  'very-bullish',
] as const)
export type ScoreBand = (typeof SCORE_BANDS)[number]

export function scoreBand(score: number): ScoreBand {
  if (score >= EXTREME_SCORE_AT) {
    return 'very-bullish'
  }
  if (score >= MILD_SCORE_AT) {
    return 'bullish'
  }
  if (score > -MILD_SCORE_AT) {
    return 'neutral'
  }
  if (score > -EXTREME_SCORE_AT) {
    return 'bearish'
  }
  return 'very-bearish'
}

/** The far end of the shared [-1, 1] scale every factor and macro driver scores on. */
export const SCORE_LIMIT = 1

/** Raw value to the shared [-1, 1] scale. Exported because macro-risk derives its drivers on the
 *  same scale, and two implementations of "which direction is bullish" would drift. */
export function normalizeFactor(raw: number, normalization: FactorNormalization): number {
  if (normalization.kind === 'linear') {
    return normalizeLinear(raw, normalization)
  }

  // Rank normalization arrives pre-ranked as a percentile in [0, 1]; p -> 2p - 1 maps it onto the
  // same [-1, 1] scale so both kinds are comparable in one weighted sum.
  const signed = raw * 2 - 1

  return normalization.direction === 'higher-is-bullish'
    ? clamp(signed, -SCORE_LIMIT, SCORE_LIMIT)
    : clamp(-signed, -SCORE_LIMIT, SCORE_LIMIT)
}

type LinearNormalization = Extract<FactorNormalization, { readonly kind: 'linear' }>

/** Direction lives in the ordering of the bounds, not a separate field: `bullishAt > bearishAt` is
 *  an upward-good factor, and the inverted ordering ramps a rising raw value toward -1. Without a
 *  neutral anchor the midpoint of the bounds scores zero; with one, each side ramps from it to its
 *  own bound, so a skewed envelope keeps both tails without scoring an ordinary reading as a lean. */
function normalizeLinear(raw: number, normalization: LinearNormalization): number {
  const { bearishAt, bullishAt } = normalization
  const neutralAt = normalization.neutralAt ?? (bearishAt + bullishAt) / 2

  // Bounds that cannot place a value on the scale would contaminate the composite with NaN.
  if (!isStrictlyBetween(neutralAt, bearishAt, bullishAt)) {
    throw new ValidationError('linear factor normalization needs neutralAt strictly between bounds')
  }

  const towardBullish = (raw - neutralAt) / (bullishAt - neutralAt)

  return towardBullish >= 0
    ? clamp(towardBullish, 0, 1)
    : -clamp((raw - neutralAt) / (bearishAt - neutralAt), 0, 1)
}

function isStrictlyBetween(value: number, first: number, second: number): boolean {
  return value > Math.min(first, second) && value < Math.max(first, second)
}

/** Coverage divides by the weight actually supplied, so a factor the caller omitted entirely would
 *  read as full coverage rather than a gap — and coverage is what lowers conviction. Counting is
 *  enough: `scoreOneFactor` has already rejected every unknown and duplicate id. */
function assertPolicyCovered<K extends FactorId>(
  seen: ReadonlySet<K>,
  policy: FactorPolicy<K>
): void {
  const declared = Object.keys(policy.weights).length

  if (seen.size !== declared) {
    throw new ValidationError(`factor scoring received ${seen.size} of ${declared} policy factors`)
  }
}

// Share of scored magnitude on the composite's side: an even split reads 0.5, a one-sided set 1.
// That makes it the composite over the mean scored magnitude, so this and the conviction band cut
// one axis at two points rather than testing two things — which is why the bar is fitted against a
// board by `scripts/research-conviction-bands.ts` and not reasoned about. Dispersion read this
// backwards — a saturated factor widens it, so a stronger trend scored as less agreement, and a
// contrarian leg is built to lean against one. All-zero has no side.
function resolveAgreement(fired: readonly FactorContribution[]): number | undefined {
  let total = 0
  let leaning = 0

  for (const contribution of fired) {
    const magnitude = contribution.weight * Math.abs(contribution.result.score)

    total += magnitude
    leaning += contribution.result.score < 0 ? -magnitude : magnitude
  }

  return total === 0 ? undefined : clamp((Math.abs(leaning) / total + 1) / 2, 0, 1)
}

function isBelowCoverage<K extends FactorId>(coverage: number, policy: FactorPolicy<K>): boolean {
  return coverage < policy.minimumCoverageFraction - COVERAGE_TOLERANCE
}

/** Absent agreement fails the threshold here, which is why a single fired factor never reads as
 *  consensus — unlike `agreementBelowMinimum`, which reports only a board that actually divided. */
function policyCaveats<K extends FactorId>(
  agreement: number | undefined,
  coverage: number,
  policy: FactorPolicy<K>
): readonly Caveat[] {
  const caveats: Caveat[] = []

  if (isBelowCoverage(coverage, policy)) {
    caveats.push({ code: 'factor.coverage-below-minimum', detail: { coverage } })
  }

  if (agreement === undefined || agreement < policy.minimumAgreement) {
    caveats.push({
      code: 'factor.agreement-below-minimum',
      detail: agreement === undefined ? {} : { agreement },
    })
  }

  return caveats
}

/** Where one value sits in a sorted population, as a percentile rank in [0, 1]. Ties share the
 *  mean of the positions they span, so forty names at zero turnover are not ordered by array
 *  position, and a value outside the population clamps to the end it fell past.
 *
 *  The population is a separate argument because the two sets differ: a name the screen rejected
 *  still reads against the board an operator can buy. Nothing to compare against scores 0.5. */
export function rankWithin(population: readonly number[], value: number): number {
  if (population.length < 2 || !Number.isFinite(value)) {
    return 0.5
  }

  let below = 0
  let tied = 0

  for (const entry of population) {
    if (entry < value) {
      below += 1
    } else if (entry === value) {
      tied += 1
    }
  }

  const position = tied === 0 ? below - 0.5 : below + (tied - 1) / 2

  return clamp(position / (population.length - 1), 0, 1)
}

export function equalWeights<K extends FactorId>(ids: readonly K[]): Readonly<Record<K, number>> {
  // why-safe: every member is assigned immediately below.
  const weights = {} as Record<K, number>

  for (const id of ids) {
    weights[id] = 1 / ids.length
  }

  return Object.freeze(weights)
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

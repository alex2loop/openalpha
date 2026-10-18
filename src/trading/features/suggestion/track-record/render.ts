import type { Locale } from '@/core/types/locale'
import type { ReviewMarkId } from '@/trading/features/suggestion/pipeline/review-marks'
import type { ActedSummary } from '@/trading/features/suggestion/track-record/acted'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  ReviewSplit,
  TrackRecordModelCount,
  TrackRecordReport,
  TrackRecordSummary,
  TrackRecordVersionCount,
} from '@/trading/features/suggestion/track-record/types'
import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import type { ConvictionBand, OutcomeStatus } from '@/trading/kernel/conviction'
import type { FactorAttribution } from '@/trading/kernel/factor'
import { formatDay, type MessageKey, t } from '@/i18n'
import { renderRateRange } from '@/trading/features/suggestion/track-record/rate-range'
import { renderActedLines } from '@/trading/features/suggestion/track-record/render-acted'
import { renderCoverageLine } from '@/trading/features/suggestion/track-record/render-coverage'
import { renderFocusLines } from '@/trading/features/suggestion/track-record/render-focus'
import { renderShadowSection } from '@/trading/features/suggestion/track-record/render-shadow'
import { renderAttributionSections } from '@/trading/render/attribution'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatFraction,
  formatRatio,
  formatSignedFraction,
  formatWholeFraction,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, joinSections, renderSectionTitle } from '@/trading/render/layout'

/** Versions sort as numbers in every host locale. */
const VERSION_COLLATION_LOCALE = 'en'

/** Only the listing is trimmed; the summary above it still scores every row the caller asked for. */
const LISTED_OUTCOME_COUNT = 5

const CONVICTION_KEYS = Object.freeze({
  low: 'trading.conviction.low',
  medium: 'trading.conviction.medium',
  high: 'trading.conviction.high',
} as const satisfies Record<ConvictionBand, MessageKey>)

const OUTCOME_KEYS = Object.freeze({
  target: 'trading.render.reflect.alertTarget',
  stop: 'trading.render.reflect.alertStop',
  expired: 'trading.render.reflect.alertExpired',
} as const satisfies Record<OutcomeStatus, MessageKey>)

const BENCHMARKED_OUTCOME_KEYS = Object.freeze({
  target: 'trading.render.reflect.alertTargetFull',
  stop: 'trading.render.reflect.alertStopFull',
  expired: 'trading.render.reflect.alertExpiredFull',
} as const satisfies Record<OutcomeStatus, MessageKey>)

/** A bucket whose sample cleared the reporting minimum; below it the rate is withheld upstream. */
interface RatedBucket extends CalibrationBucket {
  readonly winRate: number
  readonly meanReturnPct: number
}

/** What /reflect prints beside the track record itself. */
export interface ReflectSections {
  readonly attribution: readonly FactorAttribution[]
  readonly boardAttribution: readonly FactorAttribution[]
  /** One row per focus, the operator's own included. Absent where the record is not read per focus. */
  readonly focuses?: Parameters<typeof renderFocusLines>[1]
  /** Board rows scored at their last close because the name stopped trading. */
  readonly stoppedCount: number
  /** What the operator did with the calls that played out. Absent while none has. */
  readonly acted?: ActedSummary
}

/** The track record broken down from one read: overall, by conviction, by strategy version, and by
 *  factor within each version. */
export function renderReflectText(
  locale: Locale,
  report: TrackRecordReport,
  sections: ReflectSections
): string {
  const { summary } = report
  const { attribution, boardAttribution } = sections
  const header = reflectHeader(locale, summary)

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.reflect, header),
      ...renderCoverageLine(locale, summary.coverage),
      ...renderOverallLines(locale, summary),
    ],
    renderCalibrationLines(locale, summary.calibration),
    renderVersionLines(locale, summary.versions),
    renderDebateModelLines(locale, summary.debateModels),
    renderFocusLines(locale, sections.focuses),
    renderReviewLines(locale, summary.reviewSplits),
    renderActedLines(locale, sections.acted),
    ...renderAttributionSections(locale, attribution, 'trading.attribution.heading'),
    ...renderAttributionSections(locale, boardAttribution, 'trading.attribution.boardHeading'),
    renderStoppedLines(locale, sections),
    renderOutcomeLines(locale, report.recent),
    renderCaveatLines(locale, [
      ...summary.caveats,
      ...attribution.flatMap((row) => row.caveats),
      ...boardAttribution.flatMap((row) => row.caveats),
    ]),
  ])
}

/** No count at zero: the coverage line below states it, and two zeros stacked read as two facts. */
function renderStoppedLines(locale: Locale, sections: ReflectSections): readonly string[] {
  if (sections.stoppedCount === 0 || sections.boardAttribution.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.attribution.stoppedLine', {
      count: formatCount(locale, sections.stoppedCount),
    })}`,
  ]
}

/** Names are printed only when fewer than calls: equal counts say nothing the call count did not. */
export function reflectHeader(locale: Locale, summary: TrackRecordSummary): string {
  const heading = t(locale, 'trading.render.reflect.trackRecordHeading')
  const { resolvedCount, resolvedNameCount } = summary

  if (resolvedCount === 0) {
    return heading
  }

  if (resolvedNameCount < resolvedCount) {
    return t(locale, 'trading.render.reflect.scoredAcrossHeader', {
      heading,
      n: formatCount(locale, resolvedCount),
      names: formatCount(locale, resolvedNameCount),
    })
  }

  return t(locale, 'trading.render.reflect.scoredHeader', {
    heading,
    n: formatCount(locale, resolvedCount),
  })
}

/** Each figure is guarded on its own absence: a short sample answers some of these and not others,
 *  and withholding the whole line because one is missing hides the ones that were measured. */
export function renderOverallLines(locale: Locale, summary: TrackRecordSummary): readonly string[] {
  const { meanReturnPct } = summary

  if (meanReturnPct === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${renderAverageLine(locale, summary, meanReturnPct)}`,
    ...renderBenchmarkLine(locale, summary),
    `${INDENT[1]}${t(locale, 'trading.render.reflect.tally', {
      wins: formatCount(locale, summary.winCount),
      losses: formatCount(locale, summary.lossCount),
    })}`,
    ...renderShadowSection(locale, summary.shadow),
  ]
}

function renderAverageLine(
  locale: Locale,
  summary: TrackRecordSummary,
  meanReturnPct: number
): string {
  const ret = formatSignedFraction(locale, meanReturnPct)

  if (summary.medianReturnPct === undefined || summary.winRate === undefined) {
    return t(locale, 'trading.render.reflect.overallOnly', { ret })
  }

  return t(locale, 'trading.render.reflect.overallFull', {
    ret,
    median: formatSignedFraction(locale, summary.medianReturnPct),
    rate: formatWholeFraction(locale, summary.winRate),
    range: renderRateRange(locale, summary, formatWholeFraction),
    wins: formatCount(locale, summary.winCount),
    n: formatCount(locale, summary.resolvedCount),
  })
}

/** The majority verdict rides on the same line as the index it was measured against: "beat it 26 of
 *  38 times" is a count, and whether that is a majority is the question the reader actually has. */
function renderBenchmarkLine(locale: Locale, summary: TrackRecordSummary): readonly string[] {
  const { benchmarkMeanReturnPct, beatsBenchmarkMajority } = summary

  if (benchmarkMeanReturnPct === undefined) {
    return []
  }

  const shared = {
    benchAvg: formatSignedFraction(locale, benchmarkMeanReturnPct),
    beat: formatCount(locale, summary.benchmarkBeatCount),
    vsIndexN: formatCount(locale, summary.benchmarkComparedCount),
  }

  if (beatsBenchmarkMajority === undefined) {
    return [`${INDENT[1]}${t(locale, 'trading.render.reflect.benchmark', shared)}`]
  }

  const key = beatsBenchmarkMajority
    ? 'trading.render.reflect.benchmarkMajority'
    : 'trading.render.reflect.benchmarkMinority'

  return [`${INDENT[1]}${t(locale, key, shared)}`]
}

/** One version is not a split, so the section stays out until there are two. */
const REVIEW_MARK_KEYS = Object.freeze({
  'risk-lowered': 'trading.render.reflect.mark.riskLowered',
  'distribution-session': 'trading.render.reflect.mark.distributionSession',
  'crowded-side': 'trading.render.reflect.mark.crowdedSide',
  'citation-unverified': 'trading.render.reflect.mark.citationUnverified',
  'foreign-room-exhausted': 'trading.render.reflect.mark.foreignRoomExhausted',
  'chasing-gap': 'trading.render.reflect.mark.chasingGap',
} as const satisfies Record<ReviewMarkId, MessageKey>)

/** A split whose both sides cleared the minimum. */
interface RatedSplit extends ReviewSplit {
  readonly markedWinRate: number
  readonly unmarkedWinRate: number
}

function isRatedSplit(split: ReviewSplit): split is RatedSplit {
  return split.markedWinRate !== undefined && split.unmarkedWinRate !== undefined
}

/** Only marks with enough rows on both sides say anything; a section with none stays out. */
function renderReviewLines(locale: Locale, splits: readonly ReviewSplit[]): readonly string[] {
  const rated = splits.filter(isRatedSplit)

  if (rated.length === 0) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.breakdown, t(locale, 'trading.render.reflect.byReview')),
    ...rated.map(
      (split) =>
        `${INDENT[1]}${t(locale, 'trading.render.reflect.reviewLine', {
          mark: t(locale, REVIEW_MARK_KEYS[split.id]),
          markedRate: formatWholeFraction(locale, split.markedWinRate),
          markedN: formatCount(locale, split.markedCount),
          rate: formatWholeFraction(locale, split.unmarkedWinRate),
          n: formatCount(locale, split.unmarkedCount),
        })}`
    ),
  ]
}

function renderVersionLines(
  locale: Locale,
  versions: readonly TrackRecordVersionCount[]
): readonly string[] {
  const counts = countsByVersion(versions)

  if (counts.length < 2) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.breakdown, t(locale, 'trading.render.reflect.byVersion')),
    ...counts.map(
      ([version, count]) =>
        `${INDENT[1]}${t(locale, 'trading.render.reflect.versionLine', {
          version,
          n: formatCount(locale, count),
        })}`
    ),
  ]
}

/** One line per strategy version, newest first. Rows that differ only in a calculation version read
 *  as the same version twice to the operator, so their counts sum. */
function countsByVersion(
  versions: readonly TrackRecordVersionCount[]
): readonly (readonly [string, number])[] {
  const counts = new Map<string, number>()

  for (const entry of versions) {
    counts.set(
      entry.strategyVersion,
      (counts.get(entry.strategyVersion) ?? 0) + entry.resolvedCount
    )
  }

  return [...counts].sort(([left], [right]) =>
    right.localeCompare(left, VERSION_COLLATION_LOCALE, { numeric: true })
  )
}

function renderDebateModelLines(
  locale: Locale,
  models: readonly TrackRecordModelCount[]
): readonly string[] {
  if (models.length < 2) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.breakdown, t(locale, 'trading.render.reflect.byDebateModel')),
    ...models.map((entry) => `${INDENT[1]}${renderDebateModelLine(locale, entry)}`),
  ]
}

function renderDebateModelLine(locale: Locale, entry: TrackRecordModelCount): string {
  const params = {
    models: entry.models.join(', '),
    n: formatCount(locale, entry.resolvedCount),
  }

  return entry.winRate === undefined
    ? t(locale, 'trading.render.reflect.debateModelLine', params)
    : t(locale, 'trading.render.reflect.debateModelRatedLine', {
        ...params,
        rate: formatWholeFraction(locale, entry.winRate),
        range: renderRateRange(locale, entry, formatWholeFraction),
      })
}

export function renderCalibrationLines(
  locale: Locale,
  calibration: readonly CalibrationBucket[]
): readonly string[] {
  const rated = calibration.filter(isRated)

  if (rated.length === 0) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.calibration, t(locale, 'trading.render.reflect.byConviction')),
    ...rated.flatMap((bucket) => [
      `${INDENT[1]}${renderConvictionLine(locale, bucket)}`,
      ...renderStatedLine(locale, bucket),
    ]),
    ...renderMiscalibrationLines(locale, rated),
  ]
}

/** Under its band's line, so the reader sees what the role said next to what happened. */
function renderStatedLine(locale: Locale, bucket: RatedBucket): readonly string[] {
  if (bucket.brier === undefined || bucket.meanStatedProbability === undefined) {
    return []
  }

  return [
    `${INDENT[2]}${t(locale, 'trading.render.reflect.statedLine', {
      stated: formatWholeFraction(locale, bucket.meanStatedProbability),
      brier: formatRatio(locale, bucket.brier),
      n: formatCount(locale, bucket.statedCount),
    })}`,
  ]
}

function isRated(bucket: CalibrationBucket): bucket is RatedBucket {
  return bucket.winRate !== undefined && bucket.meanReturnPct !== undefined
}

/** A bucket whose benchmarked sample also cleared the minimum. Separate from `RatedBucket`: the
 *  two counts are different populations, so one can qualify while the other does not. */
interface BenchmarkedBucket extends RatedBucket {
  readonly benchmarkBeatRate: number
}

function isBenchmarked(bucket: RatedBucket): bucket is BenchmarkedBucket {
  return bucket.benchmarkBeatRate !== undefined
}

function renderConvictionLine(locale: Locale, bucket: RatedBucket): string {
  const shared = {
    band: t(locale, CONVICTION_KEYS[bucket.convictionBand]),
    hits: formatCount(locale, bucket.winCount),
    n: formatCount(locale, bucket.resolvedCount),
    rate: formatFraction(locale, bucket.winRate),
    range: renderRateRange(locale, bucket, formatFraction),
    avg: formatSignedFraction(locale, bucket.meanReturnPct),
  }

  if (!isBenchmarked(bucket)) {
    return t(locale, 'trading.render.reflect.convictionLine', shared)
  }

  return t(locale, 'trading.render.reflect.convictionLineBenchmarked', {
    ...shared,
    beatRate: formatFraction(locale, bucket.benchmarkBeatRate),
    beat: formatCount(locale, bucket.benchmarkBeatCount),
    vsIndexN: formatCount(locale, bucket.benchmarkComparedCount),
  })
}

/** A missing band means the sample never answered the question, which is not a failed calibration. */
function renderMiscalibrationLines(
  locale: Locale,
  rated: readonly RatedBucket[]
): readonly string[] {
  const high = rated.find((bucket) => bucket.convictionBand === 'high')
  const medium = rated.find((bucket) => bucket.convictionBand === 'medium')

  if (high === undefined || medium === undefined || high.winRate > medium.winRate) {
    return []
  }

  return [`${INDENT[1]}${t(locale, 'trading.render.reflect.miscalibrated')}`]
}

/** Already newest-first: the store orders resolved rows by `resolved_at` descending. */
function renderOutcomeLines(
  locale: Locale,
  rows: readonly ResolvedActionableSuggestion[]
): readonly string[] {
  const listed = rows.slice(0, LISTED_OUTCOME_COUNT)

  if (listed.length === 0) {
    return []
  }

  const header = t(locale, 'trading.render.reflect.alertsHeader', {
    shown: formatCount(locale, listed.length),
    n: formatCount(locale, rows.length),
  })

  return [
    renderSectionTitle(SECTION_ICONS.outcomes, header),
    ...listed.map((row) => `${INDENT[1]}${renderOutcomeLine(locale, row)}`),
  ]
}

/** A second key rather than an empty `{bench}`: a row resolved before its index had a reading must
 *  not print a gap where a comparison belongs. */
export function renderOutcomeLine(locale: Locale, row: ResolvedActionableSuggestion): string {
  const { outcome } = row
  const shared = {
    ticker: row.instrument.ticker,
    at: formatDay(locale, row.at),
    ret: formatSignedFraction(locale, outcome.returnPct),
    day: formatDay(locale, outcome.exitDay),
  }

  if (outcome.benchmarkReturnPct === undefined) {
    return t(locale, OUTCOME_KEYS[outcome.status], shared)
  }

  return t(locale, BENCHMARKED_OUTCOME_KEYS[outcome.status], {
    ...shared,
    bench: formatSignedFraction(locale, outcome.benchmarkReturnPct),
  })
}

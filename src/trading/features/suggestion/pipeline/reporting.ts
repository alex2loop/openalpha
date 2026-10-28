import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  ReviewSplit,
  ShadowSummary,
  TrackRecordFocusCount,
  TrackRecordModelCount,
  TrackRecordSummary,
  TrackRecordVersionCount,
} from '@/trading/features/suggestion/track-record/types'
import type {
  CalculationVersion,
  ResolvedActionableSuggestion,
} from '@/trading/features/suggestion/types'
import type { Caveat } from '@/trading/kernel/caveat'
import type { ConvictionBand, SuggestionAction } from '@/trading/kernel/conviction'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type { FocusKey } from '@/trading/kernel/operator/focus'
import { isMarked, REVIEW_MARK_IDS } from '@/trading/features/suggestion/pipeline/review-marks'
import { CONVICTION_BANDS } from '@/trading/kernel/conviction'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

/** Below this many independent calls a win rate is noise, so it is reported as absent with a
 *  caveat rather than as a number a reader would trust. */
export const MINIMUM_TRACK_RECORD_SAMPLE = 20

/** The type signature does the enforcing: `ResolvedActionableSuggestion` excludes holds and
 *  unresolved rows, so mixing them into performance is impossible rather than discouraged.
 *  Coverage is left out: these rows are one bounded window, and it counts the whole book. */
export function summarizeTrackRecord(
  scored: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): Omit<TrackRecordSummary, 'coverage'> {
  const rows = independentCalls(scored)
  const caveats: Caveat[] = []
  const folded = scored.length - rows.length

  if (folded > 0) {
    caveats.push({ code: 'reporting.repeats-folded', detail: { count: folded } })
  }

  if (rows.length < minimumSampleSize) {
    caveats.push({
      code: 'reporting.sample-below-minimum',
      detail: { count: rows.length, minimum: minimumSampleSize },
    })
  }

  const versions = groupByVersion(rows)

  // A lean population and a full population cost different amounts and must never blend silently;
  // the debate mode is one of the grouped calculation versions, so this catches that too.
  if (versions.length > 1) {
    caveats.push({
      code: 'reporting.mixed-strategy-versions',
      detail: { versions: versions.length },
    })
  }

  return {
    ...metrics(rows),
    resolvedNameCount: nameCount(rows),
    versions,
    debateModels: groupByDebateModel(rows, minimumSampleSize),
    focuses: groupByFocus(rows, minimumSampleSize),
    calibration: calibrationByBand(rows, minimumSampleSize),
    reviewSplits: splitByReviewMark(rows, minimumSampleSize),
    shadow: shadowSummary(rows),
    caveats,
  }
}

interface Metrics {
  readonly resolvedCount: number
  readonly winCount: number
  readonly lossCount: number
  readonly winRate?: number
  readonly meanReturnPct?: number
  readonly medianReturnPct?: number
  readonly benchmarkComparedCount: number
  readonly benchmarkBeatCount: number
  readonly benchmarkMeanReturnPct?: number
  readonly beatsBenchmarkMajority?: boolean
}

/** What the fold reads of a resolved call, so a lean read can be folded without its payload. */
interface FoldableCall {
  readonly at: TradingDay
  readonly instrument: InstrumentRef
  readonly action: SuggestionAction
  readonly outcome: { readonly exitDay: TradingDay }
}

/** A call repeating one still open on the same name and side rides the same move, so only the
 *  first counts: the brief re-issues a held idea every session, and each row would otherwise
 *  stand as another independent outcome. */
export function independentCalls<T extends FoldableCall>(rows: readonly T[]): readonly T[] {
  const openUntil = new Map<string, TradingDay>()
  const kept = new Set<T>()

  for (const row of [...rows].sort((left, right) => left.at.localeCompare(right.at))) {
    const key = `${buildInstrumentKey(row.instrument)}:${row.action}`
    const open = openUntil.get(key)

    if (open === undefined || row.at > open) {
      kept.add(row)
      openUntil.set(key, row.outcome.exitDay)
    }
  }

  return rows.filter((row) => kept.has(row))
}

function nameCount(rows: readonly ResolvedActionableSuggestion[]): number {
  return new Set(rows.map((row) => buildInstrumentKey(row.instrument))).size
}

function metrics(rows: readonly ResolvedActionableSuggestion[]): Metrics {
  const returns = returnsOf(rows)
  const compared = benchmarkedRows(rows)
  const beat = beatCount(compared)
  // Absent, not zero: "no resolved rows" is a different claim from "zero return".
  const rate = winRate(rows)
  const meanReturn = mean(returns)
  const medianReturn = median(returns)
  const benchmarkMean = mean(compared.map((row) => row.outcome.benchmarkReturnPct ?? 0))

  return {
    resolvedCount: rows.length,
    winCount: winCount(rows),
    lossCount: lossCount(rows),
    ...(rate === undefined ? {} : { winRate: rate }),
    ...(meanReturn === undefined ? {} : { meanReturnPct: meanReturn }),
    ...(medianReturn === undefined ? {} : { medianReturnPct: medianReturn }),
    benchmarkComparedCount: compared.length,
    benchmarkBeatCount: beat,
    ...(benchmarkMean === undefined ? {} : { benchmarkMeanReturnPct: benchmarkMean }),
    ...(compared.length === 0 ? {} : { beatsBenchmarkMajority: beat * 2 > compared.length }),
  }
}

/** Grouped by the strategy/calculation-version tuple, so an all-version view reports per-version
 *  counts rather than one blended number. */
function groupByVersion(
  rows: readonly ResolvedActionableSuggestion[]
): readonly TrackRecordVersionCount[] {
  const groups = new Map<string, Group>()

  for (const row of rows) {
    const versions = versionsOf(row)
    const key = versionKey(row.strategyVersion, versions)
    const existing = groups.get(key)

    if (existing) {
      existing.count += 1
      continue
    }

    groups.set(key, { strategyVersion: row.strategyVersion, versions, count: 1 })
  }

  return [...groups.values()].map((group) => ({
    strategyVersion: group.strategyVersion,
    calculationVersions: group.versions,
    resolvedCount: group.count,
  }))
}

interface Group {
  readonly strategyVersion: string
  readonly versions: readonly CalculationVersion[]
  count: number
}

/** The crossing rule joins the tuple the population groups by: it decides what counts as a win, so
 *  two rules blended into one win rate would describe no population that ever existed. */
function versionsOf(row: ResolvedActionableSuggestion): readonly CalculationVersion[] {
  const { formulaVersion } = row.outcome

  return formulaVersion === undefined
    ? row.calculationVersions
    : [...row.calculationVersions, { name: 'outcome', version: formulaVersion }]
}

export function versionKey(
  strategyVersion: string,
  calculationVersions: readonly CalculationVersion[]
): string {
  const parts = calculationVersions
    .map((entry) => `${entry.name}@${entry.version}`)
    .slice()
    .sort()

  return [strategyVersion, ...parts].join('|')
}

/** Win rate per band is the only way to know whether "high conviction" means anything, and the
 *  beat rate is the only way to know the win rate is not the tape. Each is gated on its own
 *  sample: a band can clear the minimum on resolved rows and fall short on benchmarked ones. */
function calibrationByBand(
  rows: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): readonly CalibrationBucket[] {
  return CONVICTION_BANDS.map((band: ConvictionBand) =>
    toCalibrationBucket(
      band,
      rows.filter((row) => row.conviction === band),
      minimumSampleSize
    )
  )
}

/** Each mark against its own complement, both sides gated on the same minimum the bands use. */
/** Grouped by the model chain that argued the debate, so a model swap splits the population it is
 *  measured on rather than blending into one rate. Rows predating the stored chain are skipped. */
function groupByDebateModel(
  rows: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): readonly TrackRecordModelCount[] {
  const groups = new Map<string, ModelGroup>()

  for (const row of rows) {
    const models = [...(row.debate?.models ?? [])].sort()

    if (models.length === 0) {
      continue
    }

    const existing = groups.get(models.join('\u0000'))

    if (existing) {
      existing.rows.push(row)
      continue
    }

    groups.set(models.join('\u0000'), { models, rows: [row] })
  }

  return [...groups.values()].map((group) => {
    const rate = group.rows.length >= minimumSampleSize ? winRate(group.rows) : undefined

    return {
      models: group.models,
      resolvedCount: group.rows.length,
      winCount: winCount(group.rows),
      ...(rate === undefined ? {} : { winRate: rate }),
    }
  })
}

/** Grouped by the focus the call was made under, in the order each focus first appears. */
function groupByFocus(
  rows: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): readonly TrackRecordFocusCount[] {
  const groups = new Map<FocusKey, ResolvedActionableSuggestion[]>()

  for (const row of rows) {
    groups.set(row.focusKey, [...(groups.get(row.focusKey) ?? []), row])
  }

  return [...groups].map(([focusKey, group]) => {
    const rate = group.length >= minimumSampleSize ? winRate(group) : undefined

    return {
      focusKey,
      resolvedCount: group.length,
      winCount: winCount(group),
      targetCount: group.filter((row) => row.outcome.status === 'target').length,
      ...(rate === undefined ? {} : { winRate: rate }),
    }
  })
}

interface ModelGroup {
  readonly models: readonly string[]
  readonly rows: ResolvedActionableSuggestion[]
}

function splitByReviewMark(
  rows: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): readonly ReviewSplit[] {
  return REVIEW_MARK_IDS.map((id) => {
    const marked = rows.filter((row) => isMarked(row, id))
    const unmarked = rows.filter((row) => !isMarked(row, id))
    const markedRate = marked.length >= minimumSampleSize ? winRate(marked) : undefined
    const unmarkedRate = unmarked.length >= minimumSampleSize ? winRate(unmarked) : undefined
    const rates =
      markedRate === undefined || unmarkedRate === undefined
        ? {}
        : { markedWinRate: markedRate, unmarkedWinRate: unmarkedRate }

    return { id, markedCount: marked.length, unmarkedCount: unmarked.length, ...rates }
  })
}

function toCalibrationBucket(
  band: ConvictionBand,
  bucket: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): CalibrationBucket {
  const compared = benchmarkedRows(bucket)
  const beat = beatCount(compared)
  const rated = bucket.length >= minimumSampleSize
  const rate = rated ? winRate(bucket) : undefined
  const average = rated ? mean(returnsOf(bucket)) : undefined
  const meanWin = rated ? mean(returnsOf(bucket.filter(isWin))) : undefined
  const meanLoss = rated ? mean(returnsOf(bucket.filter(isLoss))) : undefined
  const beatRate = compared.length >= minimumSampleSize ? beat / compared.length : undefined
  const stated = bucket.filter(hasProbability)
  const scored = stated.length >= minimumSampleSize ? brierOf(stated) : undefined

  return {
    convictionBand: band,
    resolvedCount: bucket.length,
    winCount: winCount(bucket),
    benchmarkComparedCount: compared.length,
    benchmarkBeatCount: beat,
    statedCount: stated.length,
    ...(rate === undefined ? {} : { winRate: rate }),
    ...(average === undefined ? {} : { meanReturnPct: average }),
    ...(meanWin === undefined ? {} : { meanWinPct: meanWin }),
    ...(meanLoss === undefined ? {} : { meanLossPct: meanLoss }),
    ...(beatRate === undefined ? {} : { benchmarkBeatRate: beatRate }),
    ...(scored === undefined ? {} : scored),
  }
}

/** Sequential contribution, not a compounded equity curve: each resolved row adds
 *  `sizePctNav x returnPct` in suggestion order. `sizePctNav` is a fraction of NAV despite the
 *  name — see `sizeBuy`. Overlapping holds and cash drag are deliberately unmodeled, which the
 *  caveat states; a row that carried no size contributes nothing and is counted. */
function shadowSummary(rows: readonly ResolvedActionableSuggestion[]): ShadowSummary {
  const ordered = [...rows].sort((left, right) => left.at.localeCompare(right.at))
  let running = 0
  let peak = 0
  let worstDrawdown = 0
  let sizedCount = 0
  let unsizedCount = 0

  for (const row of ordered) {
    if (row.sizePctNav === undefined) {
      unsizedCount += 1
      continue
    }

    sizedCount += 1
    running += row.sizePctNav * row.outcome.returnPct
    peak = Math.max(peak, running)
    worstDrawdown = Math.max(worstDrawdown, peak - running)
  }

  return {
    totalContribution: running,
    worstDrawdown,
    sizedCount,
    unsizedCount,
    caveats: sizedCount === 0 ? [] : [{ code: 'reporting.shadow-approximation' }],
  }
}

function winRate(rows: readonly ResolvedActionableSuggestion[]): number | undefined {
  return rows.length === 0 ? undefined : winCount(rows) / rows.length
}

function winCount(rows: readonly ResolvedActionableSuggestion[]): number {
  return rows.filter(isWin).length
}

/** Counted, not derived from the wins: a round trip that exits at its entry is neither, and
 *  `resolved - wins` would file every breakeven as a loss. */
function lossCount(rows: readonly ResolvedActionableSuggestion[]): number {
  return rows.filter(isLoss).length
}

/** Rows the resolver could price against the market's own benchmark. A market that declares none
 *  resolves without one, so this is a subset of the resolved rows, never all of them. */
function benchmarkedRows(
  rows: readonly ResolvedActionableSuggestion[]
): readonly ResolvedActionableSuggestion[] {
  return rows.filter((row) => row.outcome.benchmarkReturnPct !== undefined)
}

function beatCount(rows: readonly ResolvedActionableSuggestion[]): number {
  return rows.filter((row) => row.outcome.returnPct > (row.outcome.benchmarkReturnPct ?? 0)).length
}

type StatedRow = ResolvedActionableSuggestion & { readonly probability: number }

function hasProbability(row: ResolvedActionableSuggestion): row is StatedRow {
  return row.probability !== undefined
}

/** Scored against the same win the rate counts: a target hit and a positive expiry are one outcome
 *  here, so the score and the rate it is read beside describe one population. */
function brierOf(rows: readonly StatedRow[]): {
  readonly brier: number
  readonly meanStatedProbability: number
} {
  const squared = rows.map((row) => (row.probability - (isWin(row) ? 1 : 0)) ** 2)

  return {
    brier: squared.reduce((sum, value) => sum + value, 0) / rows.length,
    meanStatedProbability: rows.reduce((sum, row) => sum + row.probability, 0) / rows.length,
  }
}

function returnsOf(rows: readonly ResolvedActionableSuggestion[]): readonly number[] {
  return rows.map((row) => row.outcome.returnPct)
}

/** One definition of a win, so the record and every measure built on it count alike. */
export function isWinningReturn(returnPct: number): boolean {
  return returnPct > 0
}

function isWin(row: ResolvedActionableSuggestion): boolean {
  return isWinningReturn(row.outcome.returnPct)
}

function isLoss(row: ResolvedActionableSuggestion): boolean {
  return row.outcome.returnPct < 0
}

function mean(values: readonly number[]): number | undefined {
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1]
  const upper = sorted[middle]

  if (upper === undefined) {
    return undefined
  }

  return sorted.length % 2 === 1 || lower === undefined ? upper : (lower + upper) / 2
}

import type { ThemeOutcome } from '@/trading/features/themes/outcomes/store'
import type {
  BucketResult,
  ScoreBucket,
  ScorecardLine,
  ThemeScorecard,
} from '@/trading/features/themes/types'
import type { TradingDay } from '@/trading/kernel/instrument'
import { meanOf } from '@/trading/features/themes/score/compose'
import {
  OUTCOME_HORIZONS_MONTHS,
  SCORE_BUCKET_FLOORS,
  SCORE_BUCKETS,
  SCORECARD_LEVELS,
} from '@/trading/features/themes/types'

/** Fewer independent reads than this and a bucket's mean is noise: it is counted, never judged. */
const MINIMUM_BUCKET_READS = 20

interface Observation {
  readonly runId: string
  /** The name or the sector: what makes two observations the same bet, whichever theme read it. */
  readonly key: string
  readonly score: number
  readonly excess: number
  readonly entryDay: TradingDay
  readonly dueDay: TradingDay
}

/** Per horizon and level, how each score bucket did against VN-Index. */
export function buildScorecard(outcomes: readonly ThemeOutcome[]): ThemeScorecard {
  return {
    lines: OUTCOME_HORIZONS_MONTHS.flatMap((horizonMonths) => {
      const rows = outcomes.filter((outcome) => outcome.horizonMonths === horizonMonths)

      return SCORECARD_LEVELS.flatMap((level) => {
        const observations = toIndependent(
          toMergedByRun(level === 'stock' ? toStockObservations(rows) : toSectorObservations(rows))
        )

        return observations.length === 0 ? [] : [toLine(observations, { level, horizonMonths })]
      })
    }),
  }
}

function toStockObservations(rows: readonly ThemeOutcome[]): readonly Observation[] {
  return rows.flatMap((row) =>
    row.stockScore === undefined || row.result === undefined
      ? []
      : [
          {
            runId: row.runId,
            key: row.ticker,
            score: row.stockScore,
            excess: row.result.stockReturn - row.result.benchmarkReturn,
            entryDay: row.entryDay,
            dueDay: row.dueDay,
          },
        ]
  )
}

/** The equal-weight average of the names read under one sector read, once all of them resolved:
 *  a sector judged on the names that happened to resolve first is judged on a different list. */
function toSectorObservations(rows: readonly ThemeOutcome[]): readonly Observation[] {
  const groups = Map.groupBy(
    rows.filter((row) => row.sectorScore !== undefined),
    (row) => `${row.runId}:${row.themeId}:${row.sector}`
  )

  return [...groups.values()].flatMap((members) => {
    const [first] = members
    const results = members.flatMap((member) => member.result ?? [])

    if (first?.sectorScore === undefined || results.length < members.length) {
      return []
    }

    return [
      {
        runId: first.runId,
        key: first.sector,
        score: first.sectorScore,
        excess:
          meanOf(results.map((result) => result.stockReturn)) -
          meanOf(results.map((result) => result.benchmarkReturn)),
        entryDay: first.entryDay,
        dueDay: first.dueDay,
      },
    ]
  })
}

/** One run's reads of the same name or sector under several themes are one bet: they share a
 *  return, so they become one observation at their mean score. */
function toMergedByRun(observations: readonly Observation[]): readonly Observation[] {
  const groups = Map.groupBy(observations, (entry) => `${entry.runId}:${entry.key}`)

  return [...groups.values()].flatMap((members) => {
    const [first] = members

    return first === undefined
      ? []
      : [
          {
            ...first,
            score: meanOf(members.map((member) => member.score)),
            excess: meanOf(members.map((member) => member.excess)),
          },
        ]
  })
}

/** One bet counted once over time too: a later read of the same name or sector is kept only when
 *  its window starts after the kept one's ended. Weekly runs would otherwise count one three-month
 *  move thirteen times. */
function toIndependent(observations: readonly Observation[]): readonly Observation[] {
  const lastDue = new Map<string, TradingDay>()
  const kept: Observation[] = []

  for (const entry of observations.toSorted((left, right) =>
    left.entryDay.localeCompare(right.entryDay)
  )) {
    const due = lastDue.get(entry.key)

    if (due === undefined || entry.entryDay >= due) {
      kept.push(entry)
      lastDue.set(entry.key, entry.dueDay)
    }
  }

  return kept
}

function toLine(
  observations: readonly Observation[],
  key: Pick<ScorecardLine, 'level' | 'horizonMonths'>
): ScorecardLine {
  const buckets = SCORE_BUCKETS.map((bucket) =>
    toBucket(
      bucket,
      observations.filter((entry) => bucketOf(entry.score) === bucket)
    )
  )
  const separates = toSeparates(buckets)

  return { ...key, buckets, ...(separates === undefined ? {} : { separates }) }
}

function toBucket(bucket: ScoreBucket, entries: readonly Observation[]): BucketResult {
  return {
    bucket,
    reads: entries.length,
    ...(entries.length < MINIMUM_BUCKET_READS
      ? {}
      : { excessReturn: meanOf(entries.map((entry) => entry.excess)) }),
  }
}

function bucketOf(score: number): ScoreBucket | undefined {
  return SCORE_BUCKETS.find((bucket) => score >= SCORE_BUCKET_FLOORS[bucket])
}

/** Judged only when every bucket can be: then each must beat the one below it. */
function toSeparates(buckets: readonly BucketResult[]): boolean | undefined {
  const means = buckets.flatMap((bucket) => bucket.excessReturn ?? [])

  if (means.length < buckets.length) {
    return undefined
  }

  return means.slice(1).every((mean, index) => {
    const above = means[index]

    return above !== undefined && mean < above
  })
}

import type { ExcursionSummary } from '@/trading/features/suggestion/track-record/types'
import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import { isWinningReturn, outcomeVerdictOf } from '@/trading/kernel/outcome-verdict'
import { median } from '@/trading/markets/timeseries'

/** Medians in risk units over the calls that were measured, each only once its group reaches the
 *  minimum. A call resolved before excursions were stored has none and joins no group, so it never
 *  reads as zero. */
export function summarizeExcursions(
  rows: readonly ResolvedActionableSuggestion[],
  minimumSampleSize: number
): ExcursionSummary {
  const winners = measured(
    rows.filter((row) => isWinningReturn(row.outcome.returnPct)),
    'adverseExcursion'
  )
  const losers = measured(
    rows.filter((row) => !isWinningReturn(row.outcome.returnPct)),
    'adverseExcursion'
  )
  const stopped = measured(
    rows.filter((row) => outcomeVerdictOf(row.outcome) === 'stop'),
    'favorableExcursion'
  )
  const winnersAdverse = medianAtMinimum(winners, minimumSampleSize)
  const losersAdverse = medianAtMinimum(losers, minimumSampleSize)
  const stoppedFavorable = medianAtMinimum(stopped, minimumSampleSize)

  return {
    ...(winnersAdverse === undefined ? {} : { winnersAdverse }),
    ...(losersAdverse === undefined ? {} : { losersAdverse }),
    ...(stoppedFavorable === undefined ? {} : { stoppedFavorable }),
    winnersCount: winners.length,
    losersCount: losers.length,
    stoppedCount: stopped.length,
  }
}

function measured(
  rows: readonly ResolvedActionableSuggestion[],
  key: 'adverseExcursion' | 'favorableExcursion'
): readonly number[] {
  return rows.flatMap((row) => row.outcome[key] ?? [])
}

function medianAtMinimum(values: readonly number[], minimumSampleSize: number): number | undefined {
  return values.length < minimumSampleSize ? undefined : median(values)
}

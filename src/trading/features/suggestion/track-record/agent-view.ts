import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type {
  TrackRecordReport,
  TrackRecordSummary,
} from '@/trading/features/suggestion/track-record/types'
import type {
  ResolvedActionableSuggestion,
  SuggestionOutcome,
} from '@/trading/features/suggestion/types'
import { type AgentReader, priceWriter } from '@/trading/features/suggestion/agent-view'
import { fractionToPct } from '@/trading/kernel/surface/agent-json'

/** A scored call as the record lists it: which call, the levels it named and how it ended. */
interface AgentScoredCall
  extends Pick<
    ResolvedActionableSuggestion,
    'instrument' | 'at' | 'strategyVersion' | 'horizon' | 'conviction' | 'action' | 'probability'
  > {
  readonly entry: string
  readonly stop: string
  readonly target: string
  readonly takeProfit: string
  readonly outcome: SuggestionOutcome
}

interface AgentTrackRecordReport {
  readonly summary: TrackRecordSummary
  readonly recent: readonly AgentScoredCall[]
}

export function toAgentTrackRecord(
  report: TrackRecordReport,
  reader: AgentReader
): AgentTrackRecordReport {
  return {
    summary: agentSummary(report.summary),
    recent: report.recent.map((suggestion) => toScoredCall(suggestion, reader)),
  }
}

/** Rebuilt field by field, so a field added to the stored row stays out until someone adds it here. */
function toScoredCall(
  suggestion: ResolvedActionableSuggestion,
  reader: AgentReader
): AgentScoredCall {
  const price = priceWriter(suggestion.instrument, reader)

  return {
    instrument: suggestion.instrument,
    at: suggestion.at,
    strategyVersion: suggestion.strategyVersion,
    horizon: suggestion.horizon,
    conviction: suggestion.conviction,
    action: suggestion.action,
    entry: price(suggestion.entry),
    stop: price(suggestion.stop),
    target: price(suggestion.target),
    takeProfit: price(suggestion.takeProfit),
    ...(suggestion.probability === undefined ? {} : { probability: suggestion.probability }),
    outcome: agentOutcome(suggestion.outcome),
  }
}

/** The record stores returns as fractions; a model reads every `Pct` as percent. */
function agentOutcome(outcome: SuggestionOutcome): SuggestionOutcome {
  return {
    ...outcome,
    returnPct: fractionToPct(outcome.returnPct),
    ...(outcome.benchmarkReturnPct === undefined
      ? {}
      : { benchmarkReturnPct: fractionToPct(outcome.benchmarkReturnPct) }),
  }
}

function agentSummary(summary: TrackRecordSummary): TrackRecordSummary {
  return {
    ...summary,
    ...percentField('meanReturnPct', summary.meanReturnPct),
    ...percentField('medianReturnPct', summary.medianReturnPct),
    ...percentField('benchmarkMeanReturnPct', summary.benchmarkMeanReturnPct),
    calibration: summary.calibration.map(agentBucket),
  }
}

function agentBucket(bucket: CalibrationBucket): CalibrationBucket {
  return {
    ...bucket,
    ...percentField('meanReturnPct', bucket.meanReturnPct),
    ...percentField('meanWinPct', bucket.meanWinPct),
    ...percentField('meanLossPct', bucket.meanLossPct),
  }
}

function percentField<K extends string>(
  key: K,
  fraction: number | undefined
): Partial<Record<K, number>> {
  return fraction === undefined ? {} : ({ [key]: fractionToPct(fraction) } as Record<K, number>)
}

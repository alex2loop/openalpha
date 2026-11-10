import type { ScoredRow } from '@/trading/features/suggestion/pipeline/attribution'
import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { ActedSummary, RecordedFill } from '@/trading/features/suggestion/track-record/acted'
import type {
  TrackRecordOptions,
  TrackRecordReport,
  TrackRecordSummary,
} from '@/trading/features/suggestion/track-record/types'
import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketCosts } from '@/trading/markets/cost'
import type { MarketRegistry } from '@/trading/markets/types'
import { suggestionScoredRow } from '@/trading/features/suggestion/pipeline/attribution'
import {
  independentCalls,
  MINIMUM_TRACK_RECORD_SAMPLE,
  summarizeTrackRecord,
} from '@/trading/features/suggestion/pipeline/reporting'
import { summarizeActed } from '@/trading/features/suggestion/track-record/acted'
import { coverageOf } from '@/trading/features/suggestion/track-record/coverage'
import { readScoredPopulation } from '@/trading/features/suggestion/track-record/population'
import { DEFAULT_FOCUS_KEY } from '@/trading/kernel/operator/focus'
import { marketRoundTripRate } from '@/trading/markets/cost'

// The operator's record unless a focus is named: a focus call is a second opinion the operator
// never acted on. Every read placed beside the track record counts the same population.
export const BOOK_FOCUS_KEYS = [DEFAULT_FOCUS_KEY]

interface ReflectDeps {
  readonly store: Pick<SuggestionStore, 'listLeanCalls' | 'listResolved' | 'coverage'>
  readonly markets: MarketRegistry
  readonly config: TradingConfig
  /** The operator's own buys and sells since a day, read from the ledger. */
  fills(options: {
    readonly fromDay: TradingDay
    readonly signal: AbortSignal
  }): Promise<readonly RecordedFill[]>
}

export interface TrackRecordReflection {
  readonly report: TrackRecordReport
  /** The report's rows as attribution reads them, each on the long side, gross of fees. */
  readonly factorRows: readonly ScoredRow[]
  readonly acted?: ActedSummary
}

export async function reflect(
  deps: ReflectDeps,
  options: TrackRecordOptions
): Promise<TrackRecordReflection> {
  const report = await summarize(deps, options)
  const oldest = report.recent.reduce<TradingDay | undefined>(
    (day, call) => (day === undefined || call.at < day ? call.at : day),
    undefined
  )
  const calls = independentCalls(report.recent)
  const factorRows = toScoredRows(calls, deps.config)

  if (oldest === undefined) {
    return { report, factorRows }
  }

  const fills = await deps.fills({ fromDay: oldest, signal: options.signal })

  return { report, factorRows, acted: summarizeActed(calls, fills) }
}

export async function summarize(
  deps: ReflectDeps,
  options: TrackRecordOptions
): Promise<TrackRecordReport> {
  const focusKeys = options.focusKey === undefined ? BOOK_FOCUS_KEYS : [options.focusKey]
  const version =
    options.strategyVersion === undefined ? {} : { strategyVersion: options.strategyVersion }
  const population = await readScoredPopulation(deps, {
    focusKeys,
    limit: options.limit,
    markets: deps.markets,
    now: Date.now(),
    signal: options.signal,
    ...version,
  })
  const summary = withAwaiting(
    summarizeTrackRecord(population, MINIMUM_TRACK_RECORD_SAMPLE),
    population.earlyCount
  )
  const coverage = coverageOf(
    await deps.store.coverage({ focusKeys, signal: options.signal, ...version }),
    deps.markets
  )

  return { summary: { ...summary, coverage }, recent: population.calls }
}

/** Said once the rates are drawn, so a record of matured calls never reads as the whole book. */
function withAwaiting(
  summary: Omit<TrackRecordSummary, 'coverage'>,
  earlyCount: number
): Omit<TrackRecordSummary, 'coverage'> {
  if (earlyCount === 0) {
    return summary
  }

  return {
    ...summary,
    caveats: [
      ...summary.caveats,
      { code: 'reporting.awaiting-window', detail: { count: earlyCount } },
    ],
  }
}

/** The calls as attribution reads them, gross of fees: each market's round-trip rate is added back. */
export function toScoredRows(
  calls: readonly ResolvedActionableSuggestion[],
  costs: MarketCosts
): readonly ScoredRow[] {
  return calls.map((row) =>
    suggestionScoredRow(row, marketRoundTripRate(costs, row.instrument.market))
  )
}

import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import { MINIMUM_TRACK_RECORD_SAMPLE } from '@/trading/features/suggestion/pipeline/reporting'
import { buildInstrumentKey } from '@/trading/kernel/instrument'

export interface RecordedFill {
  readonly instrument: InstrumentRef
  readonly side: 'buy' | 'sell'
  readonly at: TradingDay
  readonly unitPrice: number
}

/** How the calls that played out were used: taken or passed on, and what getting in cost against
 *  the plan (Perold's implementation shortfall, per fill). Rates and averages appear only once a
 *  group reaches the reporting minimum. */
export interface ActedSummary {
  readonly resolvedCount: number
  readonly actedCount: number
  readonly actedMeanReturnPct?: number
  readonly passedMeanReturnPct?: number
  /** Positive is a worse fill than the suggested entry. */
  readonly shortfallPct?: number
}

interface ActedCall {
  readonly returnPct: number
  readonly shortfallPct?: number
}

export function summarizeActed(
  calls: readonly ResolvedActionableSuggestion[],
  fills: readonly RecordedFill[]
): ActedSummary {
  const acted: ActedCall[] = []
  const passed: number[] = []
  const taken = matchFills(calls, fills)

  for (const call of calls) {
    const fill = taken.get(call)

    if (fill === undefined) {
      passed.push(call.outcome.returnPct)
    } else {
      acted.push({ returnPct: call.outcome.returnPct, ...shortfallOf(call, fill) })
    }
  }

  const actedMean = meanAtMinimum(acted.map((entry) => entry.returnPct))
  const passedMean = meanAtMinimum(passed)
  const shortfall = meanAtMinimum(
    acted.flatMap((entry) => (entry.shortfallPct === undefined ? [] : [entry.shortfallPct]))
  )

  return {
    resolvedCount: calls.length,
    actedCount: acted.length,
    ...(actedMean === undefined || passedMean === undefined
      ? {}
      : { actedMeanReturnPct: actedMean, passedMeanReturnPct: passedMean }),
    ...(shortfall === undefined ? {} : { shortfallPct: shortfall }),
  }
}

/** One fill answers one call: a buy plan re-issued every morning is still one purchase, so each
 *  fill, oldest first, goes to the newest call it could have followed - same instrument and side,
 *  inside the window from the call's order session to the day it was scored out - that no earlier
 *  fill has taken. A fill after that window answers a later question. */
function matchFills(
  calls: readonly ResolvedActionableSuggestion[],
  fills: readonly RecordedFill[]
): ReadonlyMap<ResolvedActionableSuggestion, RecordedFill> {
  const taken = new Map<ResolvedActionableSuggestion, RecordedFill>()

  for (const fill of fills.toSorted((left, right) => left.at.localeCompare(right.at))) {
    const call = calls
      .filter((candidate) => !taken.has(candidate) && isAnsweredBy(candidate, fill))
      .toSorted((left, right) => right.at.localeCompare(left.at))[0]

    if (call !== undefined) {
      taken.set(call, fill)
    }
  }

  return taken
}

function isAnsweredBy(call: ResolvedActionableSuggestion, fill: RecordedFill): boolean {
  const side = call.action === 'buy' ? 'buy' : 'sell'
  const from = call.orderSession ?? call.at

  return (
    fill.side === side &&
    buildInstrumentKey(fill.instrument) === buildInstrumentKey(call.instrument) &&
    fill.at >= from &&
    fill.at <= call.outcome.exitDay
  )
}

function shortfallOf(
  call: ResolvedActionableSuggestion,
  fill: RecordedFill
): { readonly shortfallPct?: number } {
  if (call.entry <= 0) {
    return {}
  }

  const gap = fill.unitPrice / call.entry - 1

  return { shortfallPct: call.action === 'buy' ? gap : -gap }
}

function meanAtMinimum(values: readonly number[]): number | undefined {
  return values.length < MINIMUM_TRACK_RECORD_SAMPLE
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length
}

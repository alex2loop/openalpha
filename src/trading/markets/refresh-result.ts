import type { Caveat } from '@/trading/kernel/caveat'
import type { InstrumentRef, TradingDay } from '@/trading/kernel/instrument'
import type {
  RefreshDataKind,
  RefreshKindResult,
  RefreshKindStatus,
} from '@/trading/kernel/market/refresh'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'
import { dedupeCaveats } from '@/trading/kernel/caveat'
import { dedupeProvenance } from '@/trading/kernel/source/source-result'

export interface TargetOutcome<T> {
  readonly instrument: InstrumentRef
  readonly value?: T
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

interface KindResultInput<T> {
  readonly kind: RefreshDataKind
  readonly successStatus: 'replaced' | 'upserted'
  readonly outcomes: readonly TargetOutcome<T>[]
  readonly recordCount: number
  readonly coveredFrom?: TradingDay
  /** Names the provider re-adjusted in this pass. Absent for a kind that cannot tell. */
  readonly restatedTargets?: readonly string[]
  /** Earned by the pass rather than by any one target — what reading the scope cost, which no
   *  outcome carries because no outcome is the scope. */
  readonly caveats?: readonly Caveat[]
}

export function buildRejectedOutcome<T>(
  instrument: InstrumentRef,
  caveats: readonly Caveat[]
): TargetOutcome<T> {
  return { instrument, provenance: [], caveats }
}

export function refreshStatus(
  successfulTargetCount: number,
  targetCount: number,
  successStatus: 'replaced' | 'upserted'
): RefreshKindStatus {
  if (successfulTargetCount === 0) {
    return 'unavailable'
  }

  return successfulTargetCount === targetCount ? successStatus : 'partial'
}

export function toKindResult<T>(input: KindResultInput<T>): RefreshKindResult {
  const { kind, outcomes, recordCount } = input
  const missing = outcomes.filter((outcome) => outcome.value === undefined)
  const successfulTargetCount = outcomes.length - missing.length
  const status = refreshStatus(successfulTargetCount, outcomes.length, input.successStatus)

  return {
    kind,
    status,
    targetCount: outcomes.length,
    successfulTargetCount,
    missingTargets: missing.map((outcome) => outcome.instrument.ticker),
    recordCount,
    ...(input.coveredFrom === undefined ? {} : { coveredFrom: input.coveredFrom }),
    ...(input.restatedTargets === undefined ? {} : { restatedTargets: input.restatedTargets }),
    provenance: dedupeProvenance(outcomes.flatMap((outcome) => outcome.provenance)),
    caveats: dedupeCaveats([...(input.caveats ?? []), ...targetCaveats(outcomes, status)]),
  }
}

/** A pass whose every target failed while saying nothing needs a reason of its own. A pass caveat
 *  is not one: it describes the scope that was read, never why a target failed. */
function targetCaveats<T>(
  outcomes: readonly TargetOutcome<T>[],
  status: RefreshKindStatus
): readonly Caveat[] {
  const caveats = dedupeCaveats(outcomes.flatMap((outcome) => outcome.caveats))

  if (caveats.length === 0 && status === 'unavailable') {
    return [{ code: 'refresh.no-available-provider' }]
  }

  return caveats
}

/** A kind that attempted nothing: skipped as fresh, or refused before any target existed. */
export function emptyKindResult(
  kind: RefreshDataKind,
  status: 'fresh' | 'unavailable',
  caveats: readonly Caveat[]
): RefreshKindResult {
  return {
    kind,
    status,
    targetCount: 0,
    successfulTargetCount: 0,
    missingTargets: [],
    recordCount: 0,
    provenance: [],
    caveats,
  }
}

/** A healthy prior outcome becomes an explicit policy skip; a degraded one is returned unchanged so
 *  its counts and caveats survive the restart. Every market replays through here: one that reported
 *  a stored pass verbatim would print a full reload for a run that fetched nothing. */
export function buildReplayedResult(
  result: RefreshKindResult,
  recordCount: number
): RefreshKindResult {
  return result.status === 'replaced' || result.status === 'upserted'
    ? buildSkippedResult(result.kind, recordCount)
    : result
}

/** Distinct from `emptyKindResult`: a skip attempted nothing but still stands for the population a
 *  previous pass stored, which the operator reads as the coverage the kind currently has. */
export function buildSkippedResult(kind: RefreshDataKind, recordCount: number): RefreshKindResult {
  return {
    kind,
    status: 'fresh',
    targetCount: 0,
    successfulTargetCount: 0,
    missingTargets: [],
    recordCount,
    provenance: [],
    caveats: [],
  }
}

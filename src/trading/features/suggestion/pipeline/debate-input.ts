import type { StageRunResult } from '@/trading/features/suggestion/pipeline/stages'
import type {
  DebateDepth,
  DebateInput,
  Prepared,
  SuggestionRunOptions,
} from '@/trading/features/suggestion/pipeline/types'
import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type { Suggestion } from '@/trading/features/suggestion/types'
import type { DebateMode, LeanDebateReason } from '@/trading/kernel/config'
import { exposureOf } from '@/trading/features/suggestion/pipeline/concentration'
import { bookHoldOf } from '@/trading/features/suggestion/pipeline/direction'
import { calculationVersionsFor } from '@/trading/features/suggestion/pipeline/draft'
import { OUTCOME_FORMULA_VERSION } from '@/trading/features/suggestion/pipeline/outcomes'
import {
  MINIMUM_TRACK_RECORD_SAMPLE,
  summarizeTrackRecord,
  versionKey,
} from '@/trading/features/suggestion/pipeline/reporting'
import { roundTripWindowStart } from '@/trading/features/suggestion/pipeline/round-trip'
import { framedDirectionOf } from '@/trading/features/suggestion/types'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** Scoped to this market, strategy version, side and horizon, to the calculation versions this run
 *  will be stamped with, and to the outcome rule running now: a hit rate blended across any of them
 *  describes no population that ever traded, and it sizes buys and informs the debate alike. Side
 *  is a column; the rest live in the payload, so they are read off the bounded page. */
export async function loadCalibration(
  options: SuggestionRunOptions,
  prepared: Prepared,
  gated: StageRunResult
): Promise<readonly CalibrationBucket[]> {
  const { draft } = prepared
  const versions = versionKey(
    draft.strategyVersion,
    calculationVersionsFor(
      draft.calculationVersions,
      options.deps,
      debateDepthFor(options, gated.draft).mode
    )
  )
  const rows = await options.deps.store.listResolved({
    market: prepared.draft.instrument.market,
    strategyVersion: prepared.draft.strategyVersion,
    // A focus sizes its buys from its own record: a horizon-only focus must not blend into the book's.
    focusKeys: [options.request.focus.key],
    action: framedDirectionOf(prepared.draft),
    limit: SURFACE_LIMITS.maximumTrackRecordItems,
    signal: options.request.signal,
  })
  const population = rows.filter(
    (row) =>
      row.horizon === prepared.horizon &&
      row.outcome.formulaVersion === OUTCOME_FORMULA_VERSION &&
      versionKey(row.strategyVersion, row.calculationVersions) === versions
  )

  return summarizeTrackRecord(population, MINIMUM_TRACK_RECORD_SAMPLE).calibration
}

interface DebatePlanInput {
  readonly options: SuggestionRunOptions
  readonly prepared: Prepared
  readonly gated: StageRunResult
  readonly calibration: readonly CalibrationBucket[]
}

export function debateInputFor(input: DebatePlanInput): DebateInput {
  const { options, prepared, gated } = input

  return {
    request: options.request,
    depth: debateDepthFor(options, gated.draft),
    draft: gated.draft,
    factors: prepared.factors,
    calibration: input.calibration,
    exposure: exposureOf({
      context: prepared.context,
      instrument: prepared.instrument,
      since: roundTripWindowStart(prepared.market.manifest.calendar, prepared.draft.at),
      ...(prepared.sector === undefined ? {} : { sector: prepared.sector }),
    }),
    ...(prepared.upcomingEvents.length === 0 ? {} : { upcomingEvents: prepared.upcomingEvents }),
    ...(prepared.levels === undefined ? {} : { proposedLevels: prepared.levels }),
  }
}

/** A typed depth is the operator's and stands. `force` is the operator insisting, which means the
 *  full argument. A hold the book decided cannot be changed by any depth, so the default runs it
 *  lean and keeps the analyst's prose. */
function debateDepthFor(options: SuggestionRunOptions, draft: Suggestion): DebateDepth {
  const { request, deps } = options

  if (request.debateMode !== undefined) {
    return depthOf(request.debateMode, 'requested')
  }

  if (request.force === true) {
    return { mode: 'full' }
  }

  const settled = bookHoldOf(draft)

  if (settled !== undefined) {
    return { mode: 'lean', reason: settled }
  }

  return depthOf(deps.policy.debateMode, 'configured')
}

function depthOf(mode: DebateMode, reason: LeanDebateReason): DebateDepth {
  return mode === 'full' ? { mode } : { mode, reason }
}

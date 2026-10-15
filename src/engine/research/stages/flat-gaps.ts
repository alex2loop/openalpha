import type { Logger } from '@/core/logging/logger'

import type { ValidationGapReason } from '../evidence/gaps'
import type { EvidenceGapCandidate, FlatResearchBranch } from '../evidence/schemas'
import { MAX_GAP_VALUE_ITEMS, MAX_GAPS } from '../contracts'
import { truncateForGap } from '../evidence/normalize'

/** The admission state a rejection touches: the bounded gap list and its dedupe keys. */
interface GapRecorder {
  readonly logger?: Logger
  readonly gaps: EvidenceGapCandidate[]
  readonly validationGapKeys: Set<string>
}

interface ValidationGapInput {
  readonly reason: ValidationGapReason
  readonly values: readonly string[]
  /** Debug-only rejection detail. Never enters the gap, the artifact, or an info-level event. */
  readonly detail?: Readonly<Record<string, string | number>>
}

// Every rejection is logged before the gap list dedupes and caps it: the gap list is a bounded
// summary for the reader, this event is the complete record for whoever is debugging. `values`
// leads with the source ref; nothing here is rendered.
export function addValidationGap(recorder: GapRecorder, input: ValidationGapInput): void {
  recorder.logger?.debug('research.evidence_rejected', {
    reason: input.reason,
    values: input.values,
    ...(input.detail === undefined ? {} : { detail: boundedRejectionDetail(input.detail) }),
  })

  const key = `${input.reason}\u0000${input.values.join('\u0000')}`
  if (recorder.validationGapKeys.has(key) || recorder.gaps.length >= MAX_GAPS) {
    return
  }

  recorder.validationGapKeys.add(key)
  recorder.gaps.push(validationGap(input.reason, input.values))
}

function boundedRejectionDetail(
  detail: Readonly<Record<string, string | number>>
): Readonly<Record<string, string | number>> {
  return Object.fromEntries(
    Object.entries(detail).map(([field, value]) => [
      field,
      typeof value === 'string' ? truncateForGap(value) : value,
    ])
  )
}

function validationGap(
  reason: ValidationGapReason,
  values: readonly string[]
): EvidenceGapCandidate {
  return {
    code: 'validation',
    claimRefs: [],
    excerptRefs: [],
    sourceRefs: [],
    values,
    params: { reason },
    message: reason,
  }
}

/** The crawler authors no ids, so a branch-declared gap names no refs. Bounded on arrival. */
export function toGapCandidates(gaps: FlatResearchBranch['gaps']): EvidenceGapCandidate[] {
  return gaps.slice(0, MAX_GAPS).map((gap) => ({
    code: gap.code,
    claimRefs: [],
    excerptRefs: [],
    sourceRefs: [],
    values: (gap.values ?? []).slice(0, MAX_GAP_VALUE_ITEMS),
    message: gap.message,
  }))
}

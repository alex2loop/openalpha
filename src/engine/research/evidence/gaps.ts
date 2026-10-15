import { z } from 'zod'

import type {
  ResearchFailureCode,
  ResearchReview,
  ResearchReviewIssue,
  ReviewRoundWarning,
} from '../contracts'
import type { AdmittedEvidence, ClaimId, EvidenceExcerptId, SourceId } from './model'
import { MAX_GAP_CHARS, MAX_GAP_VALUE_ITEM_CHARS, MAX_GAP_VALUE_ITEMS } from '../contracts'

const FACTUAL_CONTRADICTION_CONFLICT_CODE = 'factual_contradiction'
const NUMERIC_MISMATCH_CONFLICT_CODE = 'numeric_mismatch'
const WHITESPACE_RUN_RE = /\s+/g
/** Gap codes whose `reason` names the failure that caused them, rather than a validation rule. */
export const FAILURE_REASON_GAP_CODES = [
  'synthesis_recovery',
  'review_incomplete',
  'revision_incomplete',
] as const

export const EvidenceCandidateGapCodeSchema = z.enum([
  'missing_support',
  'freshness_out_of_window',
  'freshness_uncertain',
  'numeric_mismatch',
  'unsafe_content',
  'provider_unavailable',
  'content_limit',
  'artifact_limit',
  'unresolved_reference',
  'duplicate_reference',
  'truncation',
  'validation',
])

const ResearchPipelineGapCodeSchema = z.enum([
  'synthesis_recovery',
  'review_incomplete',
  'revision_incomplete',
  'review_revision_required',
  'semantic_unsupported',
  'unverified_claim',
  'answer_claim_absent',
])
const EvidenceGapCodeSchema = z.union([
  EvidenceCandidateGapCodeSchema,
  ResearchPipelineGapCodeSchema,
])
export type EvidenceGapCode = z.infer<typeof EvidenceGapCodeSchema>

const EvidenceConflictCodeSchema = z.enum([
  NUMERIC_MISMATCH_CONFLICT_CODE,
  FACTUAL_CONTRADICTION_CONFLICT_CODE,
])
export type EvidenceConflictCode = z.infer<typeof EvidenceConflictCodeSchema>

const NumericConflictReasonSchema = z.enum(['link_text_mismatch', 'excerpt_not_admitted'])
export type NumericConflictReason = z.infer<typeof NumericConflictReasonSchema>

export const ValidationGapReasonSchema = z.enum([
  'source_url_not_canonical',
  'source_not_retrieved',
  'source_content_empty',
  'quote_not_in_content',
  'quote_reanchored',
  'numeric_fields_absent',
  'numeric_source_undated',
  'numeric_value_not_in_quotes',
  'duplicate_subquery',
  'unresolved_full_content',
  'followup_missing_query',
  'followup_unknown_reference',
  'followup_bound',
  'followup_duplicate',
  'coverage_unchanged',
  'question_failed',
  'low_recall',
])
export type ValidationGapReason = z.infer<typeof ValidationGapReasonSchema>

export interface EvidenceGap {
  readonly code: EvidenceGapCode
  readonly claimIds: readonly ClaimId[]
  readonly excerptIds: readonly EvidenceExcerptId[]
  readonly sourceIds: readonly SourceId[]
  readonly values: readonly string[]
  readonly params?: { readonly reason?: string | undefined }
  readonly message: string
}

interface EvidenceConflictBase {
  readonly claimIds: readonly ClaimId[]
  readonly excerptIds: readonly EvidenceExcerptId[]
  readonly message: string
}

export type EvidenceConflict = EvidenceConflictBase &
  (
    | {
        readonly code: typeof NUMERIC_MISMATCH_CONFLICT_CODE
        readonly params: { readonly reason: NumericConflictReason }
      }
    | { readonly code: typeof FACTUAL_CONTRADICTION_CONFLICT_CODE }
  )

export interface CreateGapInput {
  readonly code: EvidenceGapCode
  /** Defaults to `reason` when given, else to the code — every gap message is machine-readable. */
  readonly message?: string
  readonly reason?: ValidationGapReason | ResearchFailureCode | string
  readonly claimIds?: readonly ClaimId[]
  readonly excerptIds?: readonly EvidenceExcerptId[]
  readonly sourceIds?: readonly SourceId[]
  readonly values?: readonly string[]
}

/** The one gap constructor: every admitted-evidence gap in the feature is built here. */
export function createGap(input: CreateGapInput): EvidenceGap {
  const message = input.message ?? input.reason ?? input.code

  return {
    code: input.code,
    claimIds: input.claimIds ?? [],
    excerptIds: input.excerptIds ?? [],
    sourceIds: input.sourceIds ?? [],
    values: boundedGapValues(input.values ?? []),
    ...(input.reason === undefined ? {} : { params: { reason: input.reason } }),
    message: message.slice(0, MAX_GAP_CHARS),
  }
}

function gapSignature(gap: EvidenceGap): string {
  return JSON.stringify({
    code: gap.code,
    claimIds: [...gap.claimIds].sort(),
    excerptIds: [...gap.excerptIds].sort(),
    sourceIds: [...gap.sourceIds].sort(),
    values: [...gap.values].sort(),
    params: gap.params ?? {},
    message: gap.message.trim().replaceAll(WHITESPACE_RUN_RE, ' ').toLowerCase(),
  })
}

// Retrieval gaps and branch-local candidate gaps name their references differently, so the only
// fields both shapes share identify a retrieval gap that a branch already declared.
export function gatherGapSignature(gap: {
  readonly code: string
  readonly message: string
  readonly values: readonly string[]
}): string {
  return JSON.stringify([gap.code, gap.message, gap.values])
}

function appendUniqueGaps(
  existing: readonly EvidenceGap[],
  additions: readonly EvidenceGap[]
): readonly EvidenceGap[] {
  const seen = new Set(existing.map(gapSignature))
  const unique: EvidenceGap[] = []

  for (const gap of additions) {
    const signature = gapSignature(gap)

    if (seen.has(signature)) {
      continue
    }

    seen.add(signature)
    unique.push(gap)
  }

  return [...existing, ...unique]
}

export function addResearchGap(
  evidence: AdmittedEvidence,
  input: {
    readonly code: (typeof FAILURE_REASON_GAP_CODES)[number]
    readonly reason: ResearchFailureCode
  }
): AdmittedEvidence {
  const gap = createGap({ code: input.code, reason: input.reason, message: input.code })
  return { ...evidence, gaps: [...evidence.gaps, gap] }
}

export function addReviewGaps(
  evidence: AdmittedEvidence,
  review: ResearchReview,
  warnings: readonly ReviewRoundWarning[]
): AdmittedEvidence {
  const reviewGaps = review.issues.map(reviewIssueGap)
  const warningGaps = warnings.map(reviewWarningGap)
  const additions = [...reviewGaps, ...warningGaps]
  const gaps = additions.length === 0 ? [reviewRevisionGap()] : additions

  return { ...evidence, gaps: appendUniqueGaps(evidence.gaps, gaps) }
}

export function addReviewWarnings(
  evidence: AdmittedEvidence,
  warnings: readonly ReviewRoundWarning[]
): AdmittedEvidence {
  return {
    ...evidence,
    gaps: appendUniqueGaps(evidence.gaps, warnings.map(reviewWarningGap)),
  }
}

export function excludeUnsupportedClaims(
  evidence: AdmittedEvidence,
  unsupportedClaimIds: readonly ClaimId[]
): AdmittedEvidence {
  const rejected = new Set(unsupportedClaimIds)
  const dropped = evidence.claims.filter((claim) => rejected.has(claim.id))

  // A later pass may re-apply the same ids to already-pruned evidence; a gap naming no admitted
  // claim carries no information and would double-count in the issue summary.
  if (dropped.length === 0) {
    return evidence
  }

  const claims = evidence.claims.filter((claim) => !rejected.has(claim.id))
  const retained = new Set(claims.map((claim) => claim.id))
  // One gap per dropped claim: the issue summary counts gap records, so a batched gap reports a
  // single exclusion however many the reviewer deleted. The gap is the claim's only remaining
  // record once it leaves the artifact.
  const gaps = dropped.map((claim) =>
    createGap({
      code: 'semantic_unsupported',
      claimIds: [claim.id],
      excerptIds: claim.evidenceIds,
      values: [claim.statement],
      message: 'reviewer found that cited excerpts did not entail this claim',
    })
  )

  return {
    ...evidence,
    claims,
    numericLinks: evidence.numericLinks.filter((link) => retained.has(link.claimId)),
    gaps: appendUniqueGaps(evidence.gaps, gaps),
  }
}

/**
 * The reviewer's neutral verdict: the claim stays in the artifact, and one gap per claim is its
 * only unverified marker — excerpt text is withheld from the calling agent, so the label must
 * travel on the claim reference, not the text.
 */
export function labelUnverifiedClaims(
  evidence: AdmittedEvidence,
  unverifiedClaimIds: readonly ClaimId[]
): AdmittedEvidence {
  const unverified = new Set(unverifiedClaimIds)
  const labeled = evidence.claims.filter((claim) => unverified.has(claim.id))

  if (labeled.length === 0) {
    return evidence
  }

  const gaps = labeled.map((claim) =>
    createGap({
      code: 'unverified_claim',
      claimIds: [claim.id],
      excerptIds: claim.evidenceIds,
      values: [claim.statement],
      message: 'reviewer could not confirm this claim from its cited excerpts',
    })
  )

  return { ...evidence, gaps: appendUniqueGaps(evidence.gaps, gaps) }
}

/**
 * The review's claim-level verdicts applied together: contradicted claims leave, neutral claims
 * stay labeled. Every finalize path runs evidence through this exactly once.
 */
export function applyReviewClaimVerdicts(
  evidence: AdmittedEvidence,
  review: ResearchReview
): AdmittedEvidence {
  return labelUnverifiedClaims(
    excludeUnsupportedClaims(evidence, review.unsupportedClaimIds),
    review.unverifiedClaimIds
  )
}

function reviewIssueGap(issue: ResearchReviewIssue): EvidenceGap {
  return reviewRevisionGap(issue.description, issue.claimIds, [
    ...issue.questionIds,
    ...(issue.followUpQuery === undefined ? [] : [issue.followUpQuery]),
  ])
}

function reviewWarningGap(warning: ReviewRoundWarning): EvidenceGap {
  switch (warning.kind) {
    case 'duplicate_subquery':
      return createGap({
        code: 'validation',
        reason: 'duplicate_subquery',
        values: [warning.query],
      })
    case 'empty_followup':
      return createGap({ code: 'validation', reason: 'followup_missing_query' })
    case 'unresolved_reference':
      return createGap({
        code: 'validation',
        reason: 'followup_unknown_reference',
        values: warning.values,
      })
    case 'followup_bound':
      return createGap({ code: 'validation', reason: 'followup_bound', values: warning.values })
    case 'duplicate_candidate':
      return createGap({
        code: 'validation',
        reason: 'followup_duplicate',
        values: [warning.questionId],
      })
    case 'unchanged_coverage':
      return createGap({ code: 'validation', reason: 'coverage_unchanged' })
  }
}

function reviewRevisionGap(
  message = 'review_revision_required',
  claimIds: EvidenceGap['claimIds'] = [],
  values: readonly string[] = []
): EvidenceGap {
  return createGap({ code: 'review_revision_required', message, claimIds, values })
}

function boundedGapValues(values: readonly string[]): readonly string[] {
  return values
    .slice(0, MAX_GAP_VALUE_ITEMS)
    .map((value) => value.slice(0, MAX_GAP_VALUE_ITEM_CHARS))
}

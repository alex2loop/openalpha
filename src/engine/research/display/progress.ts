import type { ResearchDepth } from '@/core/config/resolve'
import type { LLMErrorCode } from '@/core/llm'
import type { DisplayText, LocalizedMessageParam } from '@/core/stream-events'
import { LLM_ERROR_CODES } from '@/core/llm'

import type {
  ResearchEvidenceLevel,
  ResearchFailureCode,
  ResearchPhase,
  ResearchResult,
} from '../contracts'
import type {
  ResearchOperation,
  ResearchProgress,
  ResearchStageState,
  ResearchTotalsProgress,
  ResearchWarningCode,
} from '../events'
import type {
  EvidenceConflictCode,
  EvidenceGap,
  EvidenceGapCode,
  NumericConflictReason,
  ValidationGapReason,
} from '../evidence/gaps'
import type { DateConfidence, ResearchFreshness } from '../evidence/model'
import { RESEARCH_FAILURE_CODES } from '../contracts'
import { FAILURE_REASON_GAP_CODES, ValidationGapReasonSchema } from '../evidence/gaps'
import {
  FAILURE_ACTION_KEYS,
  FAILURE_LABEL_KEYS,
  FAILURE_RESULT_KEYS,
  RESEARCH_EVIDENCE_LEVEL_KEYS,
} from './result'

// Exhaustive display-key registries: each semantic union maps to exactly one localized message key.
// `satisfies Record<Union, string>` keeps every registry complete when a union grows, and the engine
// owns these mappings so surfaces never re-derive them. The i18n leaf is never imported here.

export const RESEARCH_GAP_DISPLAY_KEYS = {
  missing_support: 'researchGaps.missingSupport',
  freshness_out_of_window: 'researchGaps.freshnessOutOfWindow',
  freshness_uncertain: 'researchGaps.freshnessUncertain',
  numeric_mismatch: 'researchGaps.numericMismatch',
  unsafe_content: 'researchGaps.unsafeContent',
  provider_unavailable: 'researchGaps.providerUnavailable',
  content_limit: 'researchGaps.contentLimit',
  artifact_limit: 'researchGaps.artifactLimit',
  unresolved_reference: 'researchGaps.unresolvedReference',
  duplicate_reference: 'researchGaps.duplicateReference',
  truncation: 'researchGaps.truncation',
  validation: 'researchGaps.validation',
  synthesis_recovery: 'researchGaps.synthesisRecovery',
  review_incomplete: 'researchGaps.reviewIncomplete',
  revision_incomplete: 'researchGaps.revisionIncomplete',
  review_revision_required: 'researchGaps.reviewRevisionRequired',
  semantic_unsupported: 'researchGaps.semanticUnsupported',
  unverified_claim: 'researchGaps.unverifiedClaim',
  answer_claim_absent: 'researchGaps.answerClaimAbsent',
} as const satisfies Record<EvidenceGapCode, string>

export const RESEARCH_CONFLICT_DISPLAY_KEYS = {
  numeric_mismatch: 'researchConflicts.numericMismatch',
  factual_contradiction: 'researchConflicts.factualContradiction',
} as const satisfies Record<EvidenceConflictCode, string>

export const RESEARCH_NUMERIC_CONFLICT_REASON_KEYS = {
  link_text_mismatch: 'researchConflicts.linkTextMismatch',
  excerpt_not_admitted: 'researchConflicts.excerptNotAdmitted',
} as const satisfies Record<NumericConflictReason, string>

export const RESEARCH_VALIDATION_REASON_KEYS = {
  source_url_not_canonical: 'researchGaps.reasonSourceUrlNotCanonical',
  source_not_retrieved: 'researchGaps.reasonSourceNotRetrieved',
  source_content_empty: 'researchGaps.reasonSourceContentEmpty',
  quote_not_in_content: 'researchGaps.reasonQuoteNotInContent',
  quote_reanchored: 'researchGaps.reasonQuoteReanchored',
  numeric_fields_absent: 'researchGaps.reasonNumericFieldsAbsent',
  numeric_source_undated: 'researchGaps.reasonNumericSourceUndated',
  numeric_value_not_in_quotes: 'researchGaps.reasonNumericValueNotInQuotes',
  duplicate_subquery: 'researchGaps.reasonDuplicateSubquery',
  unresolved_full_content: 'researchGaps.reasonUnresolvedFullContent',
  followup_missing_query: 'researchGaps.reasonFollowupMissingQuery',
  followup_unknown_reference: 'researchGaps.reasonFollowupUnknownReference',
  followup_bound: 'researchGaps.reasonFollowupBound',
  followup_duplicate: 'researchGaps.reasonFollowupDuplicate',
  coverage_unchanged: 'researchGaps.reasonCoverageUnchanged',
  question_failed: 'researchGaps.reasonQuestionFailed',
  low_recall: 'researchGaps.reasonLowRecall',
} as const satisfies Record<ValidationGapReason, string>

export const RESEARCH_DATE_CONFIDENCE_KEYS = {
  high: 'researchResults.dateConfidenceHigh',
  medium: 'researchResults.dateConfidenceMedium',
  low: 'researchResults.dateConfidenceLow',
} as const satisfies Record<DateConfidence, string>

export const RESEARCH_FRESHNESS_FIELD_KEYS = {
  publishedOn: 'researchResults.freshnessFieldPublished',
  updatedOn: 'researchResults.freshnessFieldUpdated',
  either: 'researchResults.freshnessFieldEither',
} as const satisfies Record<NonNullable<ResearchFreshness['field']>, string>

const RESEARCH_START_KEYS = {
  light: 'progress.researchStartLight',
  medium: 'progress.researchStartMedium',
  deep: 'progress.researchStartDeep',
} as const satisfies Record<ResearchDepth, string>

const RESEARCH_STAGE_KEYS = {
  running: {
    plan: 'progress.researchStagePlan',
    crawl: 'progress.researchStageCrawl',
    synthesize: 'progress.researchStageSynthesize',
    review: 'progress.researchStageReview',
  },
  complete: {
    plan: 'progress.researchStagePlanComplete',
    crawl: 'progress.researchStageCrawlComplete',
    synthesize: 'progress.researchStageSynthesizeComplete',
    review: 'progress.researchStageReviewComplete',
  },
  failed: {
    plan: 'progress.researchStagePlanFailed',
    crawl: 'progress.researchStageCrawlFailed',
    synthesize: 'progress.researchStageSynthesizeFailed',
    review: 'progress.researchStageReviewFailed',
  },
} as const satisfies Record<ResearchStageState, Record<ResearchPhase, string>>

const RESEARCH_WARNING_KEYS = {
  fallback_started: 'progress.researchWarningFallbackStarted',
} as const satisfies Record<ResearchWarningCode, string>

export const RESEARCH_OPERATION_SHORT_KEYS = {
  search: 'progress.researchOperationSearchShort',
  fetch: 'progress.researchOperationFetchShort',
  fetchBatch: 'progress.researchOperationFetchBatchShort',
} as const satisfies Record<'search' | 'fetch' | 'fetchBatch', string>

const RESEARCH_QUESTION_KEYS = {
  running: 'progress.researchQuestionRunning',
  activity: 'progress.researchQuestionActivity',
  complete: 'progress.researchQuestionComplete',
  failed: 'progress.researchQuestionFailed',
} as const satisfies Record<'running' | 'activity' | 'complete' | 'failed', string>

const RESEARCH_REVIEW_FOLLOWUP_KEYS = {
  running: 'progress.researchReviewFollowupRunning',
  complete: 'progress.researchReviewFollowupComplete',
  failed: 'progress.researchReviewFollowupFailed',
} as const satisfies Record<ResearchStageState, string>

const LLM_ERROR_DISPLAY_KEYS = {
  transient: 'llmErrors.transient',
  rate: 'llmErrors.rate',
  auth: 'llmErrors.auth',
  timeout: 'llmErrors.timeout',
  not_found: 'llmErrors.not_found',
  context_overflow: 'llmErrors.context_overflow',
  billing: 'llmErrors.billing',
  empty_response: 'llmErrors.empty_response',
  output_budget_exhausted: 'llmErrors.output_budget_exhausted',
  response_too_large: 'llmErrors.response_too_large',
  fatal: 'llmErrors.fatal',
} as const satisfies Record<LLMErrorCode, string>

type ResearchQuestionProgress = Extract<
  ResearchProgress,
  { readonly key: 'progress.researchQuestion' }
>['params']

export function toResearchStartDisplay(depth: ResearchDepth): DisplayText {
  return { key: RESEARCH_START_KEYS[depth] }
}

export function toResearchStageDisplay(
  stage: ResearchPhase,
  state: ResearchStageState,
  detail?: string | LocalizedMessageParam
): DisplayText {
  const label = { key: RESEARCH_STAGE_KEYS[state][stage] }

  return detail === undefined
    ? label
    : { key: 'progress.researchStageDetail', params: { stage: label, detail } }
}

function toResearchQuestionRunningDisplay(index: number, total: number): DisplayText {
  return { key: RESEARCH_QUESTION_KEYS.running, params: { index, total } }
}

function toResearchQuestionRetryDisplay(
  index: number,
  total: number,
  attempt: number
): DisplayText {
  return { key: 'progress.researchQuestionRetry', params: { index, total, attempt } }
}

function toResearchFallbackRunningDisplay(): DisplayText {
  return { key: 'progress.researchFallbackRunning' }
}

// A running question carries its current operation; without one there is no texture to render.
function toResearchQuestionActivityDisplay(
  question: ResearchQuestionProgress
): DisplayText | undefined {
  const operation = question.operation

  if (operation === undefined) {
    return undefined
  }

  return {
    key: RESEARCH_QUESTION_KEYS.activity,
    params: {
      index: question.index,
      total: question.total,
      activity: toResearchOperationDisplay(operation, question),
    },
  }
}

export function toResearchQuestionProgressDisplay(question: ResearchQuestionProgress): DisplayText {
  if (question.reviewFollowup !== undefined) {
    return toResearchReviewFollowupDisplay(question)
  }

  if (question.state === 'running') {
    return toRunningQuestionDisplay(question)
  }

  if (question.state === 'failed') {
    return {
      key: RESEARCH_QUESTION_KEYS.failed,
      params: {
        index: question.index,
        total: question.total,
        code: toResearchQuestionFailureDisplay(question.failureCode),
      },
    }
  }

  return {
    key: RESEARCH_QUESTION_KEYS.complete,
    params: {
      index: question.index,
      total: question.total,
      extractedClaims: question.extractedClaims ?? 0,
      candidateSources: question.candidateSources ?? 0,
    },
  }
}

// A retry or a fallback attempt is why a question is taking long, so it outranks the activity line.
function toRunningQuestionDisplay(question: ResearchQuestionProgress): DisplayText {
  if (question.fallback === true) {
    return toResearchFallbackRunningDisplay()
  }

  if (question.attempts !== undefined && question.attempts > 1) {
    return toResearchQuestionRetryDisplay(question.index, question.total, question.attempts)
  }

  return (
    toResearchQuestionActivityDisplay(question) ??
    toResearchQuestionRunningDisplay(question.index, question.total)
  )
}

function toResearchReviewFollowupDisplay(question: ResearchQuestionProgress): DisplayText {
  const followup = question.reviewFollowup
  if (followup === undefined) {
    return toResearchQuestionRunningDisplay(question.index, question.total)
  }

  return {
    key: RESEARCH_REVIEW_FOLLOWUP_KEYS[question.state],
    params: {
      index: followup.index,
      total: followup.total,
      question: question.question,
      extractedClaims: question.extractedClaims ?? 0,
      candidateSources: question.candidateSources ?? 0,
      code: toResearchQuestionFailureDisplay(question.failureCode),
    },
  }
}

function toResearchQuestionFailureDisplay(
  code: ResearchFailureCode | undefined
): LocalizedMessageParam {
  return toResearchFailureDisplay(code ?? 'unexpected')
}

export function toResearchWarningDisplay(
  code: ResearchWarningCode,
  values: Readonly<Record<string, string | number>>
): DisplayText {
  return { key: RESEARCH_WARNING_KEYS[code], params: warningDisplayParams(code, values) }
}

function toResearchOperationDisplay(
  operation: ResearchOperation,
  question: ResearchQuestionProgress
): LocalizedMessageParam {
  const detail = question.detail ?? ''
  const pageCount = question.pageCount ?? 1

  if (operation === 'search') {
    return { key: RESEARCH_OPERATION_SHORT_KEYS.search, params: { detail } }
  }

  return {
    key: RESEARCH_OPERATION_SHORT_KEYS[pageCount > 1 ? 'fetchBatch' : 'fetch'],
    params: { detail: sourceHost(detail), pageCount },
  }
}

// A running fetch reports its URL; the user only needs the host to recognize the source.
function sourceHost(url: string): string {
  try {
    const hostname = new URL(url).hostname
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname
  } catch {
    return url
  }
}

function warningDisplayParams(
  code: ResearchWarningCode,
  values: Readonly<Record<string, string | number>>
): Readonly<Record<string, string | number | LocalizedMessageParam>> {
  const reason = values.reason

  if (code !== 'fallback_started' || typeof reason !== 'string' || !isLlmErrorCode(reason)) {
    return values
  }

  return { ...values, reason: { key: LLM_ERROR_DISPLAY_KEYS[reason] } }
}

function isLlmErrorCode(value: string): value is LLMErrorCode {
  return LLM_ERROR_CODES.some((code) => code === value)
}

export function toResearchResultDisplay(result: ResearchResult): DisplayText {
  if (result.status === 'complete') {
    return {
      key:
        result.outcome === 'completed'
          ? 'researchResults.completed'
          : 'researchResults.completedWithGaps',
    }
  }

  if (result.status === 'cancelled') {
    return { key: 'researchResults.cancelled' }
  }

  if (
    result.code === 'capacity_exhausted' &&
    result.requiredCalls !== undefined &&
    result.availableCalls !== undefined
  ) {
    return {
      key: 'researchResults.capacityExhaustedWithCalls',
      params: {
        required: result.requiredCalls,
        available: result.availableCalls,
      },
    }
  }

  return { key: FAILURE_RESULT_KEYS[result.code] }
}

export function toResearchEvidenceLevelDisplay(level: ResearchEvidenceLevel): DisplayText {
  return { key: RESEARCH_EVIDENCE_LEVEL_KEYS[level] }
}

function toResearchFailureDisplay(code: ResearchFailureCode): LocalizedMessageParam {
  return { key: FAILURE_LABEL_KEYS[code] }
}

export function toResearchGapDisplay(gap: EvidenceGap): DisplayText {
  const key = RESEARCH_GAP_DISPLAY_KEYS[gap.code]

  if (FAILURE_REASON_GAP_CODES.some((code) => code === gap.code)) {
    return { key, params: { reason: failureReasonDisplay(gap) } }
  }
  if (gap.code === 'validation') {
    return { key, params: { reason: validationReasonDisplay(gap) } }
  }
  return { key }
}

function validationReasonDisplay(gap: EvidenceGap): LocalizedMessageParam {
  const parsed = ValidationGapReasonSchema.safeParse(gap.params?.reason)
  return parsed.success
    ? { key: RESEARCH_VALIDATION_REASON_KEYS[parsed.data] }
    : { key: 'researchGaps.unknownReason' }
}

function failureReasonDisplay(gap: EvidenceGap): LocalizedMessageParam {
  const reason = gap.params?.reason
  return reason !== undefined && isResearchFailureCode(reason)
    ? toResearchFailureDisplay(reason)
    : { key: 'researchGaps.unknownReason' }
}

function isResearchFailureCode(value: string): value is ResearchFailureCode {
  return RESEARCH_FAILURE_CODES.some((code) => code === value)
}

export function toResearchTotalsDisplays(totals: ResearchTotalsProgress): readonly DisplayText[] {
  return [
    {
      key: 'progress.researchRetrievalTotals',
      params: { queries: totals.queries, pagesRead: totals.pagesRead },
    },
    {
      key: 'progress.researchSupportedClaims',
      params: { sources: totals.admittedSources, claims: totals.supportedClaims },
    },
  ]
}

export function toResearchFailureActionDisplay(code: ResearchFailureCode): DisplayText {
  return { key: FAILURE_ACTION_KEYS[code] }
}

import type { Logger } from '@/core/logging/logger'
import { formatErrForLog } from '@/core/security/credentials'

import type {
  ResearchCoordinatorDeps,
  ResearchFailure,
  ResearchInvocation,
  ResearchResult,
  ResearchReview,
} from './contracts'
import type { CoverageResult } from './evidence/coverage'
import type {
  AdmittedEvidence,
  ClaimId,
  NumericEvidenceLink,
  ResearchClaim,
  ResearchRetrievalAttempt,
} from './evidence/model'
import type { ResearchEvidenceBranch, ResearchPlan } from './evidence/schemas'
import { MAX_REPORT_CLAIM_IDS, MAX_RESEARCH_ERROR_CHARS } from './contracts'
import { toResearchIssueSummaries } from './display/issue-summary'
import {
  toResearchEvidenceLevelDisplay,
  toResearchFailureActionDisplay,
  toResearchResultDisplay,
} from './display/progress'
import { ValidationGapReasonSchema } from './evidence/gaps'
import { NUMERIC_SPAN_FIELDS } from './evidence/numeric'

const MAX_LOGGED_CROSS_UNIT_CLAIMS = 8
const UNIT_WHITESPACE_RE = /\s+/g

interface CrossUnitVariantLog {
  readonly excerptId: string
  readonly canonicalUrl: string
  readonly valueText: string
  readonly unitText: string
  readonly dateText: string
}

interface CrossUnitClaimLog {
  readonly claimId: string
  readonly value: string
  readonly unit: string
  readonly scope: string
  readonly effectiveOn: string
  readonly variants: readonly CrossUnitVariantLog[]
}

interface DiagnosticParams {
  readonly reason?: string | undefined
}

interface DiagnosticItem {
  readonly code: string
  readonly params?: DiagnosticParams | undefined
  readonly values?: readonly string[]
}

interface BranchEvidenceDiagnosticsInput {
  readonly phase: 'crawl'
  readonly questionId: string
  readonly branch: ResearchEvidenceBranch
}

interface EvidenceCoverageDiagnosticsInput {
  readonly phase: 'initial' | 'revision'
  readonly evidence: AdmittedEvidence
  readonly coverage: CoverageResult
}

interface RetrievalGapsDiagnosticsInput {
  readonly questionId: string
  readonly gaps: readonly DiagnosticItem[]
}

interface ResearchPlanDiagnosticsInput {
  readonly plan: ResearchPlan
  readonly origin: 'model' | 'fallback'
}

interface FollowupDiscardedDiagnosticsInput {
  readonly questionId: string
  readonly reason: 'no_new_sources' | 'no_new_support'
}

interface ReviewVerdictDiagnosticsInput {
  readonly review: ResearchReview
  readonly claims: readonly ResearchClaim[]
}

export function logBranchEvidence(logger: Logger, input: BranchEvidenceDiagnosticsInput): void {
  logger.debug('research.branch_evidence', {
    phase: input.phase,
    questionId: input.questionId,
    sourceCount: input.branch.sources.length,
    excerptCount: input.branch.excerpts.length,
    claimCount: input.branch.claims.length,
    numericLinkCount: input.branch.numericLinks.length,
    gapCounts: countDiagnostics(input.branch.gaps),
    validationDetails: validationDetails(input.branch.gaps),
  })
}

export function logEvidenceCoverage(logger: Logger, input: EvidenceCoverageDiagnosticsInput): void {
  logger.debug('research.evidence_coverage', {
    phase: input.phase,
    sourceCount: input.evidence.sources.length,
    excerptCount: input.evidence.excerpts.length,
    candidateClaimCount: input.evidence.claims.length,
    coveredClaimCount: input.coverage.claims.length,
    numericLinkCount: input.coverage.numericLinks.length,
    droppedClaimKinds: droppedClaimKinds(input.evidence.claims, input.coverage.claims),
    gapCounts: countDiagnostics(input.coverage.gaps),
    validationDetails: validationDetails(input.coverage.gaps),
    conflictCounts: countDiagnostics(input.coverage.conflicts),
  })

  const crossUnit = crossUnitNumericClaims(input)
  if (crossUnit.length > 0) {
    logger.debug('research.cross_unit_claims', {
      phase: input.phase,
      count: crossUnit.length,
      claims: crossUnit.slice(0, MAX_LOGGED_CROSS_UNIT_CLAIMS),
    })
  }
}

// A numeric claim whose canonical unit disagrees with a source's verbatim unit (or whose sources
// disagree with each other) exists only because the model converted between units — the one
// arithmetic in the pipeline nothing verifies. Log the canonical figure plus every verbatim span
// and URL, so a reader can redo the conversion by hand.
function crossUnitNumericClaims(
  input: EvidenceCoverageDiagnosticsInput
): readonly CrossUnitClaimLog[] {
  const linksByClaim = new Map<ClaimId, NumericEvidenceLink[]>()
  for (const link of input.coverage.numericLinks) {
    const list = linksByClaim.get(link.claimId) ?? []
    list.push(link)
    linksByClaim.set(link.claimId, list)
  }

  const excerptsById = new Map(input.evidence.excerpts.map((excerpt) => [excerpt.id, excerpt]))
  const sourcesById = new Map(input.evidence.sources.map((source) => [source.id, source]))
  const logs: CrossUnitClaimLog[] = []

  for (const claim of input.coverage.claims) {
    if (claim.kind !== 'numeric') {
      continue
    }

    const links = linksByClaim.get(claim.id) ?? []
    const units = new Set(
      [claim.number.unit, ...links.map((link) => link.unitText)].map(normalizeUnitText)
    )

    if (units.size <= 1) {
      continue
    }

    logs.push({
      claimId: claim.id,
      value: claim.number.value,
      unit: claim.number.unit,
      scope: claim.number.scope,
      effectiveOn: claim.number.effectiveOn,
      variants: links.map((link) => {
        const excerpt = excerptsById.get(link.excerptId)
        const source = excerpt === undefined ? undefined : sourcesById.get(excerpt.sourceId)

        return {
          excerptId: link.excerptId,
          canonicalUrl: source?.canonicalUrl ?? '',
          valueText: link.valueText,
          unitText: link.unitText,
          dateText: link.dateText,
        }
      }),
    })
  }

  return logs
}

function normalizeUnitText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(UNIT_WHITESPACE_RE, ' ').trim()
}

// A numeric claim dropped here takes every grounded figure it carried with it.
function droppedClaimKinds(
  candidates: readonly ResearchClaim[],
  retained: readonly ResearchClaim[]
): readonly string[] {
  const keptIds = new Set(retained.map((claim) => claim.id))
  return candidates.filter((claim) => !keptIds.has(claim.id)).map((claim) => claim.kind)
}

// Retrieval gaps reach the reader on the branch the crawler returns, so a failed child leaves its
// freshness rejections, blocked content, and provider outages with nowhere to land.
export function logRetrievalGaps(logger: Logger, input: RetrievalGapsDiagnosticsInput): void {
  logger.debug('research.retrieval_gaps', {
    questionId: input.questionId,
    gapCounts: countDiagnostics(input.gaps),
  })
}

// An unusable planner answer degrades to a one-question fallback that still reports success, so a
// thin run is otherwise indistinguishable from a planned one.
export function logResearchPlan(logger: Logger, input: ResearchPlanDiagnosticsInput): void {
  logger.debug('research.plan', {
    origin: input.origin,
    questionCount: input.plan.questions.length,
    searchTermCounts: input.plan.questions.map((question) => question.searchTerms.length),
    coverageCount: input.plan.coverage.length,
  })
}

// A follow-up that retrieves pages but adds no support is dropped while the operator sees the round
// succeed.
export function logFollowupDiscarded(
  logger: Logger,
  input: FollowupDiscardedDiagnosticsInput
): void {
  logger.debug('research.followup_discarded', {
    questionId: input.questionId,
    reason: input.reason,
  })
}

// Claims the reviewer names are deleted before revision, so a run can ground a number and ship none
// of it. Kinds and dimensions are bounded enums; issue prose and follow-up queries stay out.
export function logReviewVerdict(logger: Logger, input: ReviewVerdictDiagnosticsInput): void {
  const kindById = new Map(input.claims.map((claim) => [claim.id, claim.kind]))
  const unsupported = input.review.unsupportedClaimIds

  logger.debug('research.review_verdict', {
    verdict: input.review.verdict,
    scores: input.review.scores,
    unsupportedCount: unsupported.length,
    unsupportedKinds: unsupported.map((claimId) => kindById.get(claimId) ?? 'unknown'),
    unsupportedSaturated: unsupported.length >= MAX_REPORT_CLAIM_IDS,
    unverifiedCount: input.review.unverifiedClaimIds.length,
    issueDimensions: input.review.issues.map((issue) => issue.dimension),
    researchIssueCount: input.review.issues.filter((issue) => issue.requiresResearch).length,
  })
}

// Only allowlisted span names cross: gap values also carry source urls and model prose.
function validationDetails(items: readonly DiagnosticItem[]): readonly string[] {
  return items.flatMap((item) => {
    const parsed = ValidationGapReasonSchema.safeParse(item.params?.reason)
    const fields = (item.values ?? []).filter((value) =>
      NUMERIC_SPAN_FIELDS.some((field) => field === value)
    )

    return parsed.success && fields.length > 0 ? [`${parsed.data}: ${fields.join(' ')}`] : []
  })
}

function countDiagnostics(items: readonly DiagnosticItem[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const item of items) {
    const key = diagnosticKey(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function diagnosticKey(item: DiagnosticItem): string {
  if (item.code !== 'validation') {
    return item.code
  }

  const parsed = ValidationGapReasonSchema.safeParse(item.params?.reason)
  return parsed.success ? `${item.code}:${parsed.data}` : item.code
}

interface ResearchCompletionLogInput {
  readonly deps: ResearchCoordinatorDeps
  readonly result: ResearchResult
  readonly attempts: readonly ResearchRetrievalAttempt[]
  readonly durationMs: number
}

export function logResearchCompletion(input: ResearchCompletionLogInput): void {
  const { deps, result, attempts, durationMs } = input
  const artifact = result.status === 'complete' ? result.artifact : undefined
  const evidenceSummary = result.status === 'failed' ? result.evidenceSummary : undefined
  const failures = result.status === 'cancelled' ? [] : result.failures
  const failure = result.status === 'failed' ? failures[0] : undefined
  const summary =
    result.status === 'failed'
      ? formatErrForLog(result.message).message.slice(0, MAX_RESEARCH_ERROR_CHARS)
      : undefined

  deps.logger.info('research.completed', {
    outcome: result.status === 'complete' ? result.outcome : result.status,
    durationMs: Math.max(0, durationMs),
    depth: result.depth,
    attempts: attempts.map(toAttemptLog),
    sourceCount: artifact?.sources.length ?? evidenceSummary?.admittedSources ?? 0,
    gapCount:
      artifact?.gaps.length ??
      evidenceSummary?.issues.reduce((total, issue) => total + issue.count, 0) ??
      0,
    coverageCount: artifact?.claims.length ?? evidenceSummary?.supportedClaims ?? 0,
    ...(result.status === 'failed' ? { errorCode: result.code } : {}),
    ...(result.status === 'failed' ? { failedBoundary: failure?.stage ?? 'coordinator' } : {}),
    ...(summary === undefined ? {} : { summary }),
    ...(failures.length === 0 ? {} : { failures: failures.map(toFailureLog) }),
  })
}

function toFailureLog(failure: ResearchFailure): Record<string, unknown> {
  return {
    code: failure.code,
    stage: failure.stage,
    message: failure.message,
    ...(failure.questionId === undefined ? {} : { questionId: failure.questionId }),
    ...(failure.haltCode === undefined ? {} : { haltCode: failure.haltCode }),
    ...(failure.providerModel === undefined ? {} : failure.providerModel),
  }
}

export function reportResearchTotals(input: {
  readonly invocation: ResearchInvocation
  readonly result: ResearchResult
  readonly attempts: readonly ResearchRetrievalAttempt[]
  readonly durationMs: number
}): void {
  const report = input.invocation.reportProgress
  if (report === undefined) {
    return
  }

  const retrieval = toRetrievalTotals(input.attempts)
  const artifact = input.result.status === 'complete' ? input.result.artifact : undefined
  const evidenceSummary =
    input.result.status === 'failed' ? input.result.evidenceSummary : undefined

  report({
    key: 'progress.researchTotals',
    mode: 'persistent',
    params: {
      queries: retrieval.queries,
      pagesRead: retrieval.pagesRead,
      admittedSources: artifact?.sources.length ?? evidenceSummary?.admittedSources ?? 0,
      supportedClaims: artifact?.claims.length ?? evidenceSummary?.supportedClaims ?? 0,
      issues:
        artifact === undefined
          ? (evidenceSummary?.issues ?? [])
          : toResearchIssueSummaries(artifact),
      elapsedMs: Math.round(input.durationMs),
      outcome: toResearchResultDisplay(input.result),
      ...(input.result.status === 'complete'
        ? { evidenceLevel: toResearchEvidenceLevelDisplay(input.result.evidenceLevel) }
        : {}),
      ...(input.result.status === 'failed'
        ? { action: toResearchFailureActionDisplay(input.result.code) }
        : {}),
    },
  })
}

function toRetrievalTotals(attempts: readonly ResearchRetrievalAttempt[]): {
  readonly queries: number
  readonly pagesRead: number
} {
  let queries = 0
  let pagesRead = 0

  // A cache hit replays work already counted on the attempt that filled the cache; only a call that
  // reached the provider or the web is new retrieval.
  for (const attempt of attempts) {
    if (attempt.outcome === 'cache_hit') {
      continue
    }

    if (attempt.transport === 'direct') {
      pagesRead += attempt.outcome === 'success' ? 1 : 0
    } else if (attempt.operation === 'search') {
      queries += 1
    } else {
      pagesRead += attempt.resultCount
    }
  }
  return { queries, pagesRead }
}

function toAttemptLog(attempt: ResearchRetrievalAttempt): Record<string, unknown> {
  return {
    transport: attempt.transport,
    operation: attempt.operation,
    outcome: attempt.outcome,
    latencyMs: attempt.latencyMs,
    costUsd: attempt.costUsd,
    ...(attempt.transport === 'provider'
      ? {
          provider: attempt.provider,
          role: attempt.role,
          resultCount: attempt.resultCount,
          freshness: attempt.freshness,
        }
      : {}),
    ...(attempt.failureCode === undefined ? {} : { failureCode: attempt.failureCode }),
  }
}

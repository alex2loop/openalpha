import type {
  ResearchFailure,
  ResearchFailureCode,
  ResearchResult,
  ResearchReview,
  ResearchStages,
  ReviewRoundWarning,
} from '../contracts'
import type { CrawlSummary } from '../crawl/crawl'
import type { ResearchReviewFollowupProgress } from '../events'
import type { AdmittedEvidence, ResearchReport } from '../evidence/model'
import type { ResearchEvidenceBranch, ResearchPlan, ResearchQuestion } from '../evidence/schemas'
import type { ResearchEvidenceOrigin } from '../results'
import type { StageContext } from '../stages/funnel'
import type { PreparedReviewFollowup } from './followups'
import { crawlQuestions } from '../crawl/crawl'
import { logEvidenceCoverage, logFollowupDiscarded } from '../diagnostics'
import { validateClaimCoverage } from '../evidence/coverage'
import { resolveEvidenceDisposition } from '../evidence/disposition'
import {
  addResearchGap,
  addReviewWarnings,
  applyReviewClaimVerdicts,
  excludeUnsupportedClaims,
  labelUnverifiedClaims,
} from '../evidence/gaps'
import {
  cancelledResult,
  failedFromEvidenceDisposition,
  hasFailure,
  resolveAdmittedCrawl,
} from '../results'
import { crawlDeps, evidenceHeadroomBytes, maxReportShape } from '../stages/funnel'
import { synthesizeOrRecover } from '../synthesis'
import { prepareReviewFollowups, selectNewBranches } from './followups'
import { isRevisionProgress, matchingClaimIds, reviewClaimKeys } from './progress'

// Falling back reinstates the report the revision set out to improve: right when a stage failed,
// wrong when the evidence ran out, since the verdict being applied is what emptied it.
const UNRECOVERABLE_REVISION_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'aborted',
  'insufficient_evidence',
])

export interface ResearchRevisionState {
  readonly plan: ResearchPlan
  readonly branches: readonly ResearchEvidenceBranch[]
  readonly evidence: AdmittedEvidence
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly report: ResearchReport
  readonly failures: readonly ResearchFailure[]
  readonly origin: ResearchEvidenceOrigin
  readonly reviewWarnings: readonly ReviewRoundWarning[]
  readonly reviewQuestions: readonly ResearchQuestion[]
  readonly review?: ResearchReview
}

export interface ReviewedResearchState extends ResearchRevisionState {
  readonly review: ResearchReview
}

type ResearchRevision =
  | { readonly kind: 'changed'; readonly state: ResearchRevisionState }
  | { readonly kind: 'stalled'; readonly state: ReviewedResearchState }

interface RevisionWork {
  readonly state: ReviewedResearchState
  readonly branches: readonly ResearchEvidenceBranch[]
  readonly evidence: AdmittedEvidence
  readonly outcome: ResearchRevisionState['outcome']
  readonly failures: readonly ResearchFailure[]
  readonly warnings: readonly ReviewRoundWarning[]
  readonly questions: readonly ResearchQuestion[]
}

interface ApplyFollowupInput {
  readonly ctx: StageContext
  readonly work: RevisionWork
  readonly followup: PreparedReviewFollowup
  readonly crawled: CrawlSummary
}

interface RunFollowupInput {
  readonly ctx: StageContext
  readonly work: RevisionWork
  readonly followup: PreparedReviewFollowup
  readonly progress: ResearchReviewFollowupProgress
}

interface CrawlFollowupInput {
  readonly ctx: StageContext
  readonly followup: PreparedReviewFollowup
  readonly progress: ResearchReviewFollowupProgress
}

type ApplyFollowupResult =
  | { readonly kind: 'accepted'; readonly work: RevisionWork }
  | { readonly kind: 'insufficient'; readonly work: RevisionWork }
  | { readonly kind: 'result'; readonly result: ResearchResult }

// A revision only refines a report the reviewer already accepted, so failing to refine must never
// cost more than skipping it. Returns the degraded state to finalize, or undefined when the failure
// must stay terminal: abort is the operator's instruction to stop, not a degradation.
export function revisionFallbackState(
  reviewed: ReviewedResearchState,
  revised: ResearchResult
): ReviewedResearchState | undefined {
  if (revised.status !== 'failed' || UNRECOVERABLE_REVISION_CODES.has(revised.code)) {
    return undefined
  }

  return {
    ...reviewed,
    evidence: addResearchGap(reviewed.evidence, {
      code: 'revision_incomplete',
      reason: revised.code,
    }),
    outcome: 'completed_with_gaps',
    failures: revised.failures,
  }
}

export async function reviseResearch(
  ctx: StageContext,
  state: ReviewedResearchState,
  completedReviewIndex: number
): Promise<ResearchRevision | ResearchResult> {
  const prepared = prepareReviewFollowups({
    questions: state.reviewQuestions,
    issues: state.review.issues,
    evidence: state.evidence,
    maxQuestions: ctx.maxQuestions,
    completedReviewIndex,
  })
  let work = initialWork(state, prepared.warnings)

  for (const [index, followup] of prepared.followups.entries()) {
    const revised = await runFollowup({
      ctx,
      work,
      followup,
      progress: {
        index: index + 1,
        total: prepared.followups.length,
      },
    })

    if (revised.kind === 'result') {
      return revised.result
    }
    work = revised.work
  }

  const correctionIssues = state.review.issues
    .filter((issue) => !issue.requiresResearch)
    .map((issue) => issue.description)
  const changed = work.questions.length > 0 || correctionIssues.length > 0

  if (!changed) {
    return stalledRevision(work)
  }

  return synthesizeRevision(ctx, work, completedReviewIndex)
}

function initialWork(
  state: ReviewedResearchState,
  warnings: readonly ReviewRoundWarning[]
): RevisionWork {
  return {
    state,
    branches: state.branches,
    evidence: applyReviewClaimVerdicts(state.evidence, state.review),
    outcome: state.outcome,
    failures: state.failures,
    warnings: [...state.reviewWarnings, ...warnings],
    questions: [],
  }
}

async function runFollowup(input: RunFollowupInput): Promise<ApplyFollowupResult> {
  const { ctx, work, followup, progress } = input
  const disposition = ctx.stages.classifySubquery(followup.question.question)
  if (disposition === 'duplicate') {
    return {
      kind: 'insufficient',
      work: addWarning(work, {
        kind: 'duplicate_subquery',
        query: followup.question.question,
      }),
    }
  }
  if (disposition === 'bound') {
    return {
      kind: 'insufficient',
      work: addWarning(work, {
        kind: 'followup_bound',
        values: [followup.question.question],
      }),
    }
  }

  if (ctx.quota.reserveUpTo(1) === 0) {
    return {
      kind: 'insufficient',
      work: addWarning(work, { kind: 'followup_bound', values: [followup.question.question] }),
    }
  }

  const fresh = await crawlFollowup({ ctx, followup, progress })
  return applyFollowup({ ctx, work, followup, crawled: fresh })
}

async function crawlFollowup(input: CrawlFollowupInput): Promise<CrawlSummary> {
  const { ctx, followup, progress } = input
  const stages = reviewStages(ctx.stages)

  return crawlQuestions(
    { ...crawlDeps(ctx), stages, correctionPolicy: 'none', reviewFollowup: progress },
    [followup.question]
  )
}

function reviewStages(stages: ResearchStages): ResearchStages {
  return {
    ...stages,
    crawl: (question, options) => stages.crawlFresh(question, options.budget),
  }
}

async function applyFollowup(input: ApplyFollowupInput): Promise<ApplyFollowupResult> {
  const { ctx, work, followup, crawled } = input
  if (hasFailure(crawled.failures, 'aborted')) {
    return { kind: 'result', result: cancelledResult(ctx) }
  }

  const candidates = crawled.successes.map((success) => success.branch)
  const { branches, duplicateWarnings } = selectNewBranches(work.branches, candidates)
  const next = {
    ...work,
    failures: [...work.failures, ...crawled.failures],
    warnings: [...work.warnings, ...duplicateWarnings],
  }

  if (branches.length === 0) {
    logFollowupDiscarded(ctx.logger, {
      questionId: followup.question.id,
      reason: 'no_new_sources',
    })
    return { kind: 'insufficient', work: next }
  }

  const allBranches = [...work.branches, ...branches]
  const admitted = await resolveAdmittedCrawl(ctx, {
    branches: allBranches,
    failures: next.failures,
    phase: 'revision',
  })
  if ('status' in admitted) {
    return { kind: 'result', result: admitted }
  }
  const unsupportedKeys = reviewClaimKeys(work.state, (review) => review.unsupportedClaimIds)
  const unverifiedKeys = reviewClaimKeys(work.state, (review) => review.unverifiedClaimIds)
  const evidence = labelUnverifiedClaims(
    excludeUnsupportedClaims(
      admitted.evidence,
      matchingClaimIds(admitted.evidence, unsupportedKeys)
    ),
    matchingClaimIds(admitted.evidence, unverifiedKeys)
  )
  if (!isRevisionProgress(work.evidence, evidence)) {
    logFollowupDiscarded(ctx.logger, {
      questionId: followup.question.id,
      reason: 'no_new_support',
    })
    return { kind: 'insufficient', work: next }
  }

  return {
    kind: 'accepted',
    work: {
      ...next,
      branches: allBranches,
      evidence,
      outcome: admitted.outcome,
      questions: [...work.questions, followup.question],
    },
  }
}

async function synthesizeRevision(
  ctx: StageContext,
  work: RevisionWork,
  completedReviewIndex: number
): Promise<ResearchRevision | ResearchResult> {
  const warned = addReviewWarnings(work.evidence, work.warnings)
  const coverage = validateClaimCoverage(warned)

  logEvidenceCoverage(ctx.logger, { phase: 'revision', evidence: warned, coverage })

  const disposition = resolveEvidenceDisposition(
    warned,
    coverage,
    evidenceHeadroomBytes(ctx, maxReportShape(warned))
  )

  if (disposition.kind === 'failed') {
    return failedFromEvidenceDisposition(ctx, disposition, work.failures)
  }

  const evidence = disposition.evidence
  const outcome = work.warnings.length === 0 ? disposition.outcome : 'completed_with_gaps'
  const synthesis = await synthesizeOrRecover({
    ctx,
    evidence,
    outcome,
    failures: work.failures,
    origin: work.state.origin,
    knownFutureCalls: Math.max(0, ctx.effort.reviewRoundLimit - completedReviewIndex - 2),
    correctionIssues: work.state.review.issues.map((issue) => issue.description),
  })

  if ('status' in synthesis) {
    return synthesis
  }

  return {
    kind: 'changed',
    state: {
      ...work.state,
      branches: work.branches,
      evidence,
      outcome,
      failures: work.failures,
      report: synthesis,
      reviewQuestions: [...work.state.reviewQuestions, ...work.questions],
      reviewWarnings: [],
    },
  }
}

function addWarning(work: RevisionWork, warning: ReviewRoundWarning): RevisionWork {
  return { ...work, warnings: [...work.warnings, warning] }
}

function stalledRevision(work: RevisionWork): ResearchRevision {
  return {
    kind: 'stalled',
    state: {
      ...work.state,
      failures: work.failures,
      reviewWarnings: [...work.warnings, { kind: 'unchanged_coverage' }],
    },
  }
}

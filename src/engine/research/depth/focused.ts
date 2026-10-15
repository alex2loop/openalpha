import type { ResearchFailure, ResearchResult } from '../contracts'
import type { AdmittedEvidence, ResearchReport } from '../evidence/model'
import type { ResearchEvidenceBranch, ResearchPlan, ResearchQuestion } from '../evidence/schemas'
import type { ResearchEffortProfile } from '../planning/profile'
import type { ReviewedResearchState } from '../review/revision'
import { crawlQuestions } from '../crawl/crawl'
import { addReviewGaps, applyReviewClaimVerdicts } from '../evidence/gaps'
import { planResearch, reportResearchPlan } from '../planning/planning'
import { resolveResearchEffort } from '../planning/profile'
import {
  cancelledResult,
  failedFromCrawl,
  failedFromEvidenceDisposition,
  finalizeResult,
  hasFailure,
  type ResearchEvidenceOrigin,
  reviewIncompleteResult,
} from '../results'
import { computeReviewVerdict } from '../review/followups'
import { reviseResearch, revisionFallbackState } from '../review/revision'
import {
  admitCrawlEvidence,
  crawlDeps,
  reportResearchQuestionRunning,
  type StageContext,
} from '../stages/funnel'
import { reviewReport } from '../stages/runs'
import { synthesizeOrRecover } from '../synthesis'
import { createExactQueryQuestion, isFallbackEligible, runExactQueryFallback } from './fallback'
import { fundPlan } from './funding'

const FOCUSED_QUESTION_ID = 'q1'

interface FocusedState {
  readonly branches: readonly ResearchEvidenceBranch[]
  readonly evidence: AdmittedEvidence
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly failures: readonly ResearchFailure[]
  readonly origin: ResearchEvidenceOrigin
}

interface SynthesizedFocusedState extends FocusedState {
  readonly report: ResearchReport
}

interface FocusedCrawlInput {
  readonly successes: readonly { readonly branch: ResearchEvidenceBranch }[]
  readonly failures: readonly ResearchFailure[]
}

interface ReviewMediumInput {
  readonly ctx: StageContext
  readonly material: SynthesizedFocusedState
  readonly effort: ResearchEffortProfile
  readonly plan: ResearchPlan
}

export async function runLight(ctx: StageContext): Promise<ResearchResult> {
  const focused = await gatherExactEvidence(ctx)
  if ('status' in focused) {
    return focused
  }

  const synthesized = await synthesizeFocused(ctx, focused)
  if ('status' in synthesized) {
    return synthesized
  }

  return finalizeResult({ ctx, ...synthesized })
}

export async function runMedium(ctx: StageContext): Promise<ResearchResult> {
  const ceiling = resolveResearchEffort({
    depth: 'medium',
    complexity: 'complex',
    maxQuestions: ctx.config.maxQuestions,
    maxBudgetedQuestions: ctx.maxBudgetedQuestions,
    maxReviewRounds: ctx.config.maxReviewRounds,
    maxParallelDelegations: ctx.maxParallelDelegations,
    availableDelegations: ctx.quota.spare(),
    reservedReviewRounds: ctx.effort.reviewRoundLimit,
  })
  // The `complex` ceiling is the planner's upper bound; the post-plan effort
  // (planned.effort.questionLimit) is the authoritative downstream limit and may be lower when the
  // planner classifies the query `standard`. Inference is bounded structurally by
  // validateResearchPlan/repairResearchPlan/fallbackResearchPlan, which apply at every depth.
  const planned = await planResearch(ctx, {
    query: ctx.request.query,
    depth: 'medium',
    locale: ctx.invocation.locale,
    maxQuestions: ceiling.questionLimit,
    deterministicObjective: ctx.objective,
    allowObjectiveInference: true,
  })
  if (planned.kind === 'failed') {
    return planned.result.code === 'aborted' ? cancelledResult(ctx) : planned.result
  }

  const funded = fundPlan(ctx, planned)
  const runCtx = {
    ...ctx,
    objective: funded.objective,
    effort: funded.effort,
    maxQuestions: funded.effort.questionLimit,
  }

  reportResearchPlan(runCtx, funded.plan)

  const focused = await gatherMediumEvidence(runCtx, funded.plan.questions)
  if ('status' in focused) {
    return focused
  }

  const synthesized = await synthesizeFocused(runCtx, focused)
  if ('status' in synthesized) {
    return synthesized
  }

  return reviewMedium({
    ctx: runCtx,
    material: synthesized,
    effort: funded.effort,
    plan: funded.plan,
  })
}

async function gatherExactEvidence(ctx: StageContext): Promise<FocusedState | ResearchResult> {
  const question = focusedQuestion(ctx.objective.normalized)

  reportResearchQuestionRunning(ctx, question, { index: 1, total: 1 })

  const crawl = await crawlQuestions(crawlDeps(ctx), [question])

  if (hasFailure(crawl.failures, 'aborted')) {
    return cancelledResult(ctx)
  }
  if (crawl.successes.length === 0) {
    return failedFromCrawl(ctx, crawl.failures, 'no evidence from the exact query')
  }

  return admitFocused(ctx, crawl, 'planned')
}

async function gatherMediumEvidence(
  ctx: StageContext,
  questions: readonly ResearchQuestion[]
): Promise<FocusedState | ResearchResult> {
  const crawl = await crawlQuestions(crawlDeps(ctx), questions)

  if (hasFailure(crawl.failures, 'aborted')) {
    return cancelledResult(ctx)
  }
  if (crawl.successes.length > 0) {
    return admitFocused(ctx, crawl, 'planned')
  }
  if (!isFallbackEligible(crawl.failures)) {
    return failedFromCrawl(ctx, crawl.failures, 'no evidence from any planned branch')
  }

  const fallback = await runExactQueryFallback(ctx)
  const failures = [...crawl.failures, ...fallback.failures]
  if (hasFailure(failures, 'aborted')) {
    return cancelledResult(ctx)
  }
  if (fallback.successes.length === 0) {
    return failedFromCrawl(ctx, failures, 'no evidence from planned or fallback research')
  }

  return admitFocused(ctx, { successes: fallback.successes, failures }, 'fallback')
}

async function admitFocused(
  ctx: StageContext,
  crawl: FocusedCrawlInput,
  origin: ResearchEvidenceOrigin
): Promise<FocusedState | ResearchResult> {
  const disposition = await admitCrawlEvidence(ctx, {
    branches: crawl.successes.map((success) => success.branch),
    failures: crawl.failures,
  })

  if (disposition.kind === 'cancelled') {
    return cancelledResult(ctx)
  }

  if (disposition.kind === 'failed') {
    return failedFromEvidenceDisposition(ctx, disposition, crawl.failures)
  }

  return {
    branches: crawl.successes.map((success) => success.branch),
    evidence: disposition.evidence,
    outcome: origin === 'fallback' ? 'completed_with_gaps' : disposition.outcome,
    failures: crawl.failures,
    origin,
  }
}

async function synthesizeFocused(
  ctx: StageContext,
  focused: FocusedState
): Promise<SynthesizedFocusedState | ResearchResult> {
  const synthesis = await synthesizeOrRecover({
    ctx,
    evidence: focused.evidence,
    outcome: focused.outcome,
    failures: focused.failures,
    origin: focused.origin,
    knownFutureCalls: 0,
  })

  if ('status' in synthesis) {
    return synthesis
  }

  return { ...focused, report: synthesis }
}

async function reviewMedium(input: ReviewMediumInput): Promise<ResearchResult> {
  const { ctx, material, effort, plan } = input
  if (effort.reviewRoundLimit === 0) {
    return finalizeResult({ ctx, ...material })
  }

  // The reviewer is screened against the question ids it was shown, so it must be shown them on
  // the first round too: reviewing without them makes every question reference unknown and spends
  // the stage's one correction retry proving it.
  const reviewable = { ...material, reviewQuestions: plan.questions }

  const review = await reviewReport(ctx, reviewable, 0)
  if (review.kind === 'halted' && review.reason === 'aborted') {
    return cancelledResult(ctx)
  }
  if (review.kind !== 'value') {
    return reviewIncompleteResult(ctx, reviewable, review)
  }

  if (computeReviewVerdict(review.value, ctx.config.reviewThreshold) === 'approve') {
    return finalizeResult({
      ctx,
      ...reviewable,
      evidence: applyReviewClaimVerdicts(material.evidence, review.value),
      review: review.value,
    })
  }

  const reviewed: ReviewedResearchState = {
    ...reviewable,
    plan,
    review: review.value,
    reviewWarnings: [],
  }
  const revised = await reviseResearch(ctx, reviewed, 0)

  if ('status' in revised) {
    const fallback = revisionFallbackState(reviewed, revised)

    return fallback === undefined ? revised : finalizeReviewedMedium(ctx, fallback)
  }
  if (revised.kind === 'changed') {
    return finalizeResult({
      ctx,
      evidence: revised.state.evidence,
      report: revised.state.report,
      outcome: revised.state.outcome,
      failures: revised.state.failures,
      origin: revised.state.origin,
    })
  }

  return finalizeResult({
    ctx,
    ...revised.state,
    evidence: addReviewGaps(
      applyReviewClaimVerdicts(revised.state.evidence, revised.state.review),
      revised.state.review,
      revised.state.reviewWarnings
    ),
    outcome: 'completed_with_gaps',
  })
}

function finalizeReviewedMedium(ctx: StageContext, state: ReviewedResearchState): ResearchResult {
  return finalizeResult({
    ctx,
    evidence: applyReviewClaimVerdicts(state.evidence, state.review),
    report: state.report,
    outcome: state.outcome,
    failures: state.failures,
    origin: state.origin,
    review: state.review,
  })
}

function focusedQuestion(query: string): ResearchQuestion {
  return createExactQueryQuestion(FOCUSED_QUESTION_ID, query)
}

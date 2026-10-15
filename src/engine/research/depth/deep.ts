import type { Locale } from '@/core/types/locale'

import type {
  FailedResearchResult,
  ResearchFailure,
  ResearchPlanLimitBase,
  ResearchPlanLimits,
  ResearchResult,
  ReviewResearchPlan,
} from '../contracts'
import type { AdmittedEvidence } from '../evidence/model'
import type { ResearchPlan } from '../evidence/schemas'
import type { ResearchEffortProfile, ResearchObjective } from '../planning/profile'
import { crawlQuestions } from '../crawl/crawl'
import {
  addResearchGap,
  addReviewGaps,
  addReviewWarnings,
  applyReviewClaimVerdicts,
} from '../evidence/gaps'
import { planResearch, reportResearchPlan } from '../planning/planning'
import { resolveResearchEffort } from '../planning/profile'
import {
  cancelledResult,
  childFailure,
  failedFromCrawl,
  finalizeResult,
  hasFailure,
  resolveAdmittedCrawl,
} from '../results'
import { computeReviewVerdict } from '../review/followups'
import {
  type ResearchRevisionState,
  type ReviewedResearchState,
  reviseResearch,
  revisionFallbackState,
} from '../review/revision'
import { crawlDeps, reportResearchQuestionsRunning, type StageContext } from '../stages/funnel'
import { reviewReport } from '../stages/runs'
import { synthesizeOrRecover } from '../synthesis'
import { isFallbackEligible, runExactQueryFallback } from './fallback'
import { type ApprovedResearchPlan, fundPlan } from './funding'

export async function runDeep(ctx: StageContext): Promise<ResearchResult> {
  // Top-level deep never auto-starts: without a reviewer able to collect an explicit start, the
  // run fails closed before any planning cost. Delegated children keep the deterministic plan.
  if (isTopLevelResearch(ctx) && interactiveReview(ctx) === undefined) {
    return cancelledResult(ctx)
  }

  const ceiling = resolvePlanningCeiling(ctx)
  const planned = await planResearch(ctx, planningInput(ctx, ceiling.questionLimit))
  if (planned.kind === 'failed') {
    return planned.result.code === 'aborted' ? cancelledResult(ctx) : planned.result
  }

  const approved = await approvePlan(ctx, planned)
  if ('status' in approved) {
    return approved
  }

  const funded = fundPlan(ctx, approved)
  const runCtx = {
    ...ctx,
    objective: funded.objective,
    effort: funded.effort,
    maxQuestions: funded.effort.questionLimit,
  }

  return executeFromPlan(runCtx, funded.plan)
}

async function approvePlan(
  ctx: StageContext,
  planned: ApprovedResearchPlan
): Promise<
  ApprovedResearchPlan | FailedResearchResult | Extract<ResearchResult, { status: 'cancelled' }>
> {
  const interactive = interactiveReview(ctx)

  // Only delegated children reach this branch: runDeep cancels a top-level run with no reviewer.
  if (interactive === undefined) {
    reportResearchPlan(ctx, planned.plan)
    return planned
  }

  const decision = await interactive.reviewPlan({
    plan: planned.plan,
    objective: planned.objective,
    effort: planned.effort,
    canEdit: true,
    signal: ctx.invocation.signal,
    limits: toPlanLimits(interactive.limitBase, planned.effort),
  })
  if (decision.kind === 'cancel' || ctx.invocation.signal.aborted) {
    return cancelledResult(ctx)
  }
  if (decision.kind === 'start') {
    reportResearchQuestionsRunning(ctx, planned.plan.questions)
    return planned
  }

  const revised = await replan(ctx, planned, decision.instruction)
  if (revised.kind === 'failed') {
    return revised.result.code === 'aborted' ? cancelledResult(ctx) : revised.result
  }

  const finalDecision = await interactive.reviewPlan({
    plan: revised.plan,
    objective: revised.objective,
    effort: revised.effort,
    canEdit: false,
    signal: ctx.invocation.signal,
    limits: toPlanLimits(interactive.limitBase, revised.effort),
  })

  if (finalDecision.kind === 'start' && !ctx.invocation.signal.aborted) {
    reportResearchQuestionsRunning(ctx, revised.plan.questions)
    return revised
  }
  return cancelledResult(ctx)
}

// A revision the quota cannot fund puts the plan the reviewer already saw back in front of them to
// start or cancel, rather than failing the run for want of one planner call.
function replan(
  ctx: StageContext,
  planned: ApprovedResearchPlan,
  instruction: string
): ReturnType<typeof planResearch> {
  if (ctx.quota.reserveUpTo(1) === 0) {
    return Promise.resolve({ kind: 'value', ...planned })
  }

  return planResearch(ctx, {
    ...planningInput(ctx, resolvePlanningCeiling(ctx).questionLimit),
    previousPlan: planned.plan,
    revision: instruction,
  })
}

function toPlanLimits(
  base: ResearchPlanLimitBase,
  effort: ResearchEffortProfile
): ResearchPlanLimits {
  return { ...base, maxQuestions: effort.questionLimit, maxReviewRounds: effort.reviewRoundLimit }
}

function resolvePlanningCeiling(ctx: StageContext): ResearchEffortProfile {
  return resolveResearchEffort({
    depth: 'deep',
    complexity: 'complex',
    maxQuestions: ctx.config.maxQuestions,
    maxBudgetedQuestions: ctx.maxBudgetedQuestions,
    maxReviewRounds: ctx.config.maxReviewRounds,
    maxParallelDelegations: ctx.maxParallelDelegations,
    availableDelegations: ctx.quota.spare(),
    reservedReviewRounds: ctx.effort.reviewRoundLimit,
  })
}

async function executeFromPlan(ctx: StageContext, plan: ResearchPlan): Promise<ResearchResult> {
  const crawled = await crawlQuestions(crawlDeps(ctx), plan.questions)

  if (hasFailure(crawled.failures, 'aborted')) {
    return cancelledResult(ctx)
  }
  if (crawled.successes.length === 0) {
    return fallbackFromPlan(ctx, crawled.failures)
  }

  const branches = crawled.successes.map((success) => success.branch)
  const admitted = await resolveAdmittedCrawl(ctx, { branches, failures: crawled.failures })
  if ('status' in admitted) {
    return admitted
  }

  const synthesis = await synthesizeOrRecover({
    ctx,
    evidence: admitted.evidence,
    outcome: admitted.outcome,
    failures: crawled.failures,
    origin: 'planned',
    knownFutureCalls: Math.max(0, ctx.effort.reviewRoundLimit - 1),
  })

  if ('status' in synthesis) {
    return synthesis
  }

  return runReviewLoop(ctx, {
    plan,
    branches,
    evidence: admitted.evidence,
    outcome: admitted.outcome,
    report: synthesis,
    failures: crawled.failures,
    origin: 'planned',
    reviewWarnings: [],
    reviewQuestions: plan.questions,
  })
}

async function fallbackFromPlan(
  ctx: StageContext,
  plannedFailures: readonly ResearchFailure[]
): Promise<ResearchResult> {
  if (!isFallbackEligible(plannedFailures)) {
    return failedFromCrawl(ctx, plannedFailures, 'no evidence from any planned branch')
  }

  const fallback = await runExactQueryFallback(ctx)
  const failures = [...plannedFailures, ...fallback.failures]
  if (hasFailure(failures, 'aborted')) {
    return cancelledResult(ctx)
  }
  if (fallback.successes.length === 0) {
    return failedFromCrawl(ctx, failures, 'no evidence from planned or fallback research')
  }

  const branches = fallback.successes.map((success) => success.branch)
  const admitted = await resolveAdmittedCrawl(ctx, { branches, failures })
  if ('status' in admitted) {
    return admitted
  }

  const synthesis = await synthesizeOrRecover({
    ctx,
    evidence: admitted.evidence,
    outcome: 'completed_with_gaps',
    failures,
    origin: 'fallback',
    knownFutureCalls: 0,
  })

  if ('status' in synthesis) {
    return synthesis
  }

  return finalizeResult({
    ctx,
    evidence: admitted.evidence,
    report: synthesis,
    outcome: 'completed_with_gaps',
    failures,
    origin: 'fallback',
  })
}

async function runReviewLoop(
  ctx: StageContext,
  initial: ResearchRevisionState
): Promise<ResearchResult> {
  let state = initial

  for (let call = 0; call < ctx.effort.reviewRoundLimit; call++) {
    const reviewed = await runReviewRound(ctx, state, call)
    if ('status' in reviewed) {
      return reviewed
    }

    if (computeReviewVerdict(reviewed.review, ctx.config.reviewThreshold) === 'approve') {
      return finishDeep(ctx, reviewed)
    }

    const revised = await reviseResearch(ctx, reviewed, call)
    if ('status' in revised) {
      const fallback = revisionFallbackState(reviewed, revised)
      return fallback === undefined ? revised : finishDeep(ctx, fallback)
    }
    if (revised.kind === 'stalled') {
      return finishDeep(ctx, revised.state)
    }
    state = revised.state
  }

  return finishDeep(ctx, state)
}

async function runReviewRound(
  ctx: StageContext,
  state: ResearchRevisionState,
  call: number
): Promise<ReviewedResearchState | ResearchResult> {
  const result = await reviewReport(ctx, state, ctx.effort.reviewRoundLimit - call - 1)
  if (result.kind === 'value') {
    return { ...state, review: result.value }
  }
  if (result.kind === 'halted' && result.reason === 'aborted') {
    return cancelledResult(ctx)
  }

  const failure = childFailure('review', result, 'invalid_output')
  return finishDeep(ctx, {
    ...state,
    evidence: addResearchGap(state.evidence, {
      code: 'review_incomplete',
      reason: failure.code,
    }),
    outcome: 'completed_with_gaps',
    failures: [...state.failures, failure],
  })
}

function finishDeep(ctx: StageContext, state: ResearchRevisionState): ResearchResult {
  const approved =
    state.review === undefined ||
    computeReviewVerdict(state.review, ctx.config.reviewThreshold) === 'approve'
  const evidence = finishEvidence(state, approved)
  const hasReviewGaps = !approved || state.reviewWarnings.length > 0

  return finalizeResult({
    ctx,
    ...state,
    evidence,
    outcome: hasReviewGaps ? 'completed_with_gaps' : state.outcome,
  })
}

function finishEvidence(state: ResearchRevisionState, approved: boolean): AdmittedEvidence {
  if (state.review === undefined) {
    return state.evidence
  }

  const evidence = applyReviewClaimVerdicts(state.evidence, state.review)
  if (approved) {
    return addReviewWarnings(evidence, state.reviewWarnings)
  }
  return addReviewGaps(evidence, state.review, state.reviewWarnings)
}

function isTopLevelResearch(ctx: StageContext): boolean {
  const parent = ctx.invocation.parent
  return parent === undefined || parent.callDepth === 0
}

// Interactive plan-review is the approval gate for top-level deep: the reviewer sees the inferred
// objective and can edit it before anything runs. Objective inference is enabled only inside this
// reviewable flow (planningInput); a delegated child without a reviewer keeps the deterministic
// objective and is still bounded by validateResearchPlan/repairResearchPlan/fallbackResearchPlan.
function interactiveReview(
  ctx: StageContext
):
  | { readonly reviewPlan: ReviewResearchPlan; readonly limitBase: ResearchPlanLimitBase }
  | undefined {
  const { reviewPlan, planLimitBase } = ctx.invocation

  if (reviewPlan === undefined || planLimitBase === undefined) {
    return undefined
  }

  return { reviewPlan, limitBase: planLimitBase }
}

function planningInput(
  ctx: StageContext,
  maxQuestions: number
): {
  readonly query: string
  readonly depth: 'deep'
  readonly locale: Locale
  readonly maxQuestions: number
  readonly deterministicObjective: ResearchObjective
  readonly allowObjectiveInference: boolean
} {
  return {
    query: ctx.request.query,
    depth: 'deep',
    locale: ctx.invocation.locale,
    maxQuestions,
    deterministicObjective: ctx.objective,
    allowObjectiveInference: interactiveReview(ctx) !== undefined,
  }
}

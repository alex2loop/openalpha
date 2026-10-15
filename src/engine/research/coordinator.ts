import type { ResearchDepth } from '@/core/config/resolve'
import type { DelegationQuota } from '@/core/tool'
import type { ExternalCharge } from '@/core/types/usage'
import { RESEARCH_PROFILE_DEPTHS } from '@/core/config/resolve'
import { RunHalted, ToolError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

import type {
  FailedResearchResult,
  ResearchBudgetPool,
  ResearchCoordinator,
  ResearchCoordinatorDeps,
  ResearchInvocation,
  ResearchQuota,
  ResearchRequest,
  ResearchResult,
  ResearchStages,
} from './contracts'
import type { ResearchRetrievalAttempt } from './evidence/model'
import type {
  ResearchComplexity,
  ResearchEffortProfile,
  ResearchObjective,
} from './planning/profile'
import type { StageContext } from './stages/funnel'
import { createResearchBudgetPool, researchBranchCallCapacity } from './budget'
import { QUOTA_EXHAUSTED_MESSAGE } from './contracts'
import { runDeep } from './depth/deep'
import { runLight, runMedium } from './depth/focused'
import { logResearchCompletion, reportResearchTotals } from './diagnostics'
import {
  CALLS_PER_REVIEW_ROUND,
  normalizeResearchObjective,
  resolveResearchEffort,
} from './planning/profile'
import { createResearchRetrievalState } from './retrieval/state'
import { createResearchStages } from './stages/stages'

export function createResearchCoordinator(deps: ResearchCoordinatorDeps): ResearchCoordinator {
  return {
    run: (request, invocation) => runResearch(deps, request, invocation),
  }
}

async function runResearch(
  deps: ResearchCoordinatorDeps,
  request: ResearchRequest,
  invocation: ResearchInvocation
): Promise<ResearchResult> {
  const depth = request.depth ?? RESEARCH_PROFILE_DEPTHS.standard
  const now = Date.now()
  const startedAt = performance.now()
  const retrievalAttempts: ResearchRetrievalAttempt[] = []
  const retrievalState = createResearchRetrievalState({
    maxSubqueries: deps.config.research.maxSubqueries,
    maxContentBytesPerSource: deps.config.research.maxFullTextBytesPerSource,
  })
  let budgets: ResearchBudgetPool | undefined
  let stages: ResearchStages | undefined
  let result: ResearchResult

  try {
    if (invocation.signal.aborted) {
      result = { status: 'cancelled', depth }
    } else {
      invocation.reportProgress?.({
        key: 'progress.researchStart',
        mode: 'persistent',
        params: { depth },
      })
      result = await executeResearch({
        deps,
        request,
        invocation,
        depth,
        now,
        retrievalState,
        retrievalAttempts,
        setBudgets: (value) => {
          budgets = value
        },
        setStages: (value) => {
          stages = value
        },
      })
    }
  } catch (err: unknown) {
    result = mapResearchError({ deps, depth, invocation, err })
  } finally {
    releaseResearch({ budgets, stages, retrievalState })
  }

  const durationMs = performance.now() - startedAt

  reportResearchTotals({
    invocation,
    result,
    attempts: retrievalAttempts,
    durationMs,
  })
  logResearchCompletion({
    deps,
    result,
    attempts: retrievalAttempts,
    durationMs,
  })
  return result
}

interface ExecuteResearchInput {
  readonly deps: ResearchCoordinatorDeps
  readonly request: ResearchRequest
  readonly invocation: ResearchInvocation
  readonly depth: StageContext['depth']
  readonly now: number
  readonly retrievalState: ReturnType<typeof createResearchRetrievalState>
  readonly retrievalAttempts: ResearchRetrievalAttempt[]
  readonly setBudgets: (budgets: ResearchBudgetPool) => void
  readonly setStages: (stages: ResearchStages) => void
}

interface CoordinatorEffortInput {
  readonly execution: ExecuteResearchInput
  readonly complexity: ResearchComplexity
  readonly availableDelegations: number
  readonly reservedReviewRounds: number
  readonly maxBudgetedQuestions: number
}

interface InitialResearchProfile {
  readonly objective: ResearchObjective
  readonly effort: ResearchEffortProfile
  readonly maxBudgetedQuestions: number
}

async function executeResearch(input: ExecuteResearchInput): Promise<ResearchResult> {
  const { deps, request, invocation, depth } = input
  const initial = resolveInitialResearchProfile(input)
  const reserved = reserveRunQuota({
    depth,
    effort: initial.effort,
    quota: invocation.delegationQuota,
  })

  if (reserved.kind === 'rejected') {
    return capacityExhaustedResult(depth, reserved.requiredCalls, reserved.availableCalls)
  }

  const { quota } = reserved
  const effort = resolveReservedEffort(input, initial, quota)
  const budgets = createResearchBudgetPool(invocation.budget, depth)
  const recordExternalCost = async (charge: ExternalCharge): Promise<void> => {
    await invocation.addExternalCost(charge)
    budgets.chargeExternalCost(charge.costUsd)
  }
  const stages = createResearchStages({
    now: input.now,
    runner: deps.runner,
    invocation,
    quota,
    budgets,
    logger: deps.logger,
    retrieval: deps.retrieval,
    recordExternalCost,
    retrievalState: input.retrievalState,
    retrievalAttempts: input.retrievalAttempts,
    researchConfig: deps.config.research,
    ...(request.freshness === undefined ? {} : { freshness: request.freshness }),
  })
  input.setBudgets(budgets)
  input.setStages(stages)

  return await runDepth({
    logger: deps.logger,
    depth,
    request,
    invocation,
    stages,
    quota,
    budgets,
    config: deps.config.research,
    now: input.now,
    objective: initial.objective,
    effort,
    maxQuestions: effort.questionLimit,
    maxBudgetedQuestions: initial.maxBudgetedQuestions,
    maxParallelDelegations: deps.config.loop.maxParallelDelegations,
    retrievalAttempts: input.retrievalAttempts,
  })
}

function resolveInitialResearchProfile(input: ExecuteResearchInput): InitialResearchProfile {
  const { request, invocation, depth } = input
  const objective = normalizeResearchObjective({
    query: request.query,
    depth,
    allowPlannedObjective: false,
    ...(request.freshness === undefined ? {} : { freshness: request.freshness }),
  })
  const maxBudgetedQuestions = researchBranchCallCapacity(invocation.budget, depth)
  const effort = resolveCoordinatorEffort({
    execution: input,
    complexity: objective.complexity,
    availableDelegations: invocation.delegationQuota.remaining(),
    reservedReviewRounds: 0,
    maxBudgetedQuestions,
  })

  return { objective, effort, maxBudgetedQuestions }
}

// Resolved again against what the reservation left: the question limit counts only calls that can
// still be reserved, not the ones this run already holds.
function resolveReservedEffort(
  input: ExecuteResearchInput,
  initial: InitialResearchProfile,
  quota: ResearchQuota
): ResearchEffortProfile {
  return resolveCoordinatorEffort({
    execution: input,
    complexity: initial.objective.complexity,
    availableDelegations: quota.spare(),
    reservedReviewRounds: initial.effort.reviewRoundLimit,
    maxBudgetedQuestions: initial.maxBudgetedQuestions,
  })
}

function capacityExhaustedResult(
  depth: StageContext['depth'],
  requiredCalls: number,
  availableCalls: number
): FailedResearchResult {
  return {
    status: 'failed',
    depth,
    code: 'capacity_exhausted',
    message: `research requires ${requiredCalls} calls but only ${availableCalls} are available`,
    failures: [],
    requiredCalls,
    availableCalls,
  }
}

function resolveCoordinatorEffort(input: CoordinatorEffortInput): ResearchEffortProfile {
  return resolveResearchEffort({
    depth: input.execution.depth,
    complexity: input.complexity,
    maxQuestions: input.execution.deps.config.research.maxQuestions,
    maxBudgetedQuestions: input.maxBudgetedQuestions,
    maxReviewRounds: input.execution.deps.config.research.maxReviewRounds,
    maxParallelDelegations: input.execution.deps.config.loop.maxParallelDelegations,
    availableDelegations: input.availableDelegations,
    reservedReviewRounds: input.reservedReviewRounds,
  })
}

function runDepth(ctx: StageContext): Promise<ResearchResult> {
  switch (ctx.depth) {
    case 'light':
      return runLight(ctx)
    case 'medium':
      return runMedium(ctx)
    case 'deep':
      return runDeep(ctx)
  }
}

// Disposal runs even if settling throws, so a failed settle never leaks the stage or retrieval
// state.
function releaseResearch(held: {
  readonly budgets: ResearchBudgetPool | undefined
  readonly stages: ResearchStages | undefined
  readonly retrievalState: ReturnType<typeof createResearchRetrievalState>
}): void {
  try {
    held.budgets?.settle()
  } finally {
    held.stages?.dispose()
    held.retrievalState.dispose()
  }
}

function mapResearchError(input: {
  deps: ResearchCoordinatorDeps
  depth: StageContext['depth']
  invocation: ResearchInvocation
  err: unknown
}): ResearchResult {
  if (input.invocation.signal.aborted) {
    return { status: 'cancelled', depth: input.depth }
  }

  if (input.err instanceof RunHalted) {
    if (input.err.code === 'abort') {
      return { status: 'cancelled', depth: input.depth }
    }
    if (input.err.code === 'budget') {
      return failedEnvelope(input.depth, 'budget_exhausted', input.err.message)
    }
  }

  if (input.err instanceof ToolError && input.err.code === 'delegate_full') {
    return failedEnvelope(input.depth, 'capacity_exhausted', input.err.message)
  }

  const formatted = formatErrForLog(input.err)
  return failedEnvelope(input.depth, 'unexpected', formatted.message)
}

function failedEnvelope(
  depth: StageContext['depth'],
  code: FailedResearchResult['code'],
  message: string
): FailedResearchResult {
  return {
    status: 'failed',
    depth,
    code,
    message,
    failures: [],
  }
}

interface ReserveRunQuotaInput {
  readonly depth: ResearchDepth
  readonly effort: ResearchEffortProfile
  readonly quota: DelegationQuota
}

type ReserveRunQuotaResult =
  | { readonly kind: 'admitted'; readonly quota: ResearchQuota }
  | {
      readonly kind: 'rejected'
      readonly requiredCalls: number
      readonly availableCalls: number
    }

function mandatoryCalls(depth: ResearchDepth, maxReviewRounds: number): number {
  const planCalls = depth === 'light' ? 0 : 1
  const crawlerCalls = 1
  const firstSynthesisCalls = 1
  const reviewRounds = depth === 'light' ? 0 : Math.max(0, maxReviewRounds)

  return planCalls + crawlerCalls + firstSynthesisCalls + reviewRounds * CALLS_PER_REVIEW_ROUND
}

/** Up-front delegation reservation for a run's mandatory calls; per-question calls reserve later. */
function reserveRunQuota(input: ReserveRunQuotaInput): ReserveRunQuotaResult {
  const mandatory = mandatoryCalls(input.depth, input.effort.reviewRoundLimit)
  const available = input.quota.remaining()

  if (available < mandatory) {
    return {
      kind: 'rejected',
      requiredCalls: mandatory,
      availableCalls: available,
    }
  }

  return { kind: 'admitted', quota: createResearchQuota(input.quota, mandatory) }
}

function createResearchQuota(parent: DelegationQuota, prereserved: number): ResearchQuota {
  parent.reserve(prereserved)
  let available = prereserved

  return {
    reserveUpTo(count: number): number {
      const granted = Math.min(Math.max(0, Math.floor(count)), parent.remaining())

      parent.reserve(granted)
      available += granted

      return granted
    },
    claim(): void {
      if (available < 1) {
        throw new ToolError('delegate_full', QUOTA_EXHAUSTED_MESSAGE)
      }

      available -= 1
    },
    spare(): number {
      return parent.remaining()
    },
  }
}

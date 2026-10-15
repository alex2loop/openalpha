import type { BudgetSlice } from '@/engine/types/cost'

import type { FailedResearchResult, ResearchChildResult, ResearchPlanningInput } from '../contracts'
import type { ResearchPlan, ResearchQuestion } from '../evidence/schemas'
import type { StageContext } from '../stages/funnel'
import type { ResearchEffortProfile, ResearchObjective } from './profile'
import { MAX_QUESTION_CHARS, MAX_RESEARCH_LIST_ITEMS } from '../contracts'
import { createExactQueryQuestion } from '../depth/fallback'
import { logResearchPlan } from '../diagnostics'
import { truncateOnCodePoint } from '../evidence/normalize'
import { uncoveredQueryEntities } from '../query-entities'
import { failedFromChild } from '../results'
import {
  reportResearchPlanCard,
  reportResearchQuestionsRunning,
  reportResearchStage,
  runResearchStageWork,
} from '../stages/funnel'
import {
  normalizeObjectiveText,
  normalizeResearchObjective,
  resolveResearchEffort,
} from './profile'

const MAX_OBJECTIVE_OVERLAP_RATIO = 0.6
const SEARCH_QUALIFIER = ' official source'
const TOKEN_RE = /\s+/

interface RunSettledPlanInput {
  readonly ctx: StageContext
  readonly planning: ResearchPlanningInput
  readonly slice: BudgetSlice
}

interface ResolvedPlanProfile {
  readonly plan: ResearchPlan
  readonly objective: ResearchObjective
  readonly effort: ResearchEffortProfile
}

type PlanResearchResult =
  | {
      readonly kind: 'value'
      readonly plan: ResearchPlan
      readonly objective: ResearchObjective
      readonly effort: ResearchEffortProfile
    }
  | { readonly kind: 'failed'; readonly result: FailedResearchResult }

export async function planResearch(
  ctx: StageContext,
  input: ResearchPlanningInput
): Promise<PlanResearchResult> {
  const result = await runResearchStageWork(ctx, {
    stage: 'plan',
    run: () => runPlanResearch(ctx, input),
  })
  if (result.kind === 'value') {
    reportResearchStage(ctx, { stage: 'plan', state: 'complete' })
  } else if (result.result.code !== 'aborted') {
    reportResearchStage(ctx, { stage: 'plan', state: 'failed' })
  }
  return result
}

async function runPlanResearch(
  ctx: StageContext,
  input: ResearchPlanningInput
): Promise<PlanResearchResult> {
  const first = await runPlanAttempt(ctx, input)
  if (first.kind === 'halted' && first.reason === 'aborted') {
    return {
      kind: 'failed',
      result: failedFromChild({
        ctx,
        stage: 'plan',
        result: first,
        invalidCode: 'planner_failed',
      }),
    }
  }

  if (first.kind === 'value') {
    const initial = resolvePlanProfile(ctx, input, first.value)
    const repaired = repairResearchPlan(initial.plan, {
      query: input.query,
      maxQuestions: initial.effort.questionLimit,
    })
    const resolved = resolvePlanProfile(ctx, input, repaired)

    if (validateResearchPlan(resolved.plan).length === 0) {
      logResearchPlan(ctx.logger, { plan: resolved.plan, origin: 'model' })
      logUncoveredPlanEntities(ctx, resolved.plan, input.query)
      return { kind: 'value', ...resolved }
    }
  }

  const fallback = resolvePlanProfile(ctx, input, fallbackResearchPlan(input))
  logResearchPlan(ctx.logger, { plan: fallback.plan, origin: 'fallback' })
  return { kind: 'value', ...fallback }
}

// An entity the plan never names is planner drift, not a reason to discard the plan: the fallback
// it would be replaced by is a single question, which covers less.
function logUncoveredPlanEntities(ctx: StageContext, plan: ResearchPlan, query: string): void {
  const uncovered = uncoveredQueryEntities(
    query,
    plan.questions.flatMap((question) => [
      question.question,
      question.objective,
      ...question.searchTerms,
    ])
  )

  if (uncovered.length > 0) {
    ctx.logger.warn('research.plan_entity_uncovered', { uncovered })
  }
}

function repairResearchPlan(
  plan: ResearchPlan,
  input: { readonly query: string; readonly maxQuestions: number }
): ResearchPlan {
  const questions: ResearchQuestion[] = []
  const seenQuestions = new Set<string>()
  const limit = Math.max(1, Math.floor(input.maxQuestions))

  for (const question of plan.questions) {
    const questionKey = normalizePlanText(question.question)
    const overlapsExisting = questions.some(
      (existing) =>
        objectiveOverlapRatio(existing.objective, question.objective) > MAX_OBJECTIVE_OVERLAP_RATIO
    )

    if (seenQuestions.has(questionKey) || overlapsExisting) {
      continue
    }

    seenQuestions.add(questionKey)
    questions.push({
      ...question,
      id: `q${questions.length + 1}`,
      searchTerms: repairSearchTerms(question),
    })

    if (questions.length >= limit) {
      break
    }
  }

  if (questions.length === 0) {
    questions.push(fallbackQuestion(input.query))
  }

  return {
    objective: plan.objective,
    questions,
    coverage: questions.map((question) => ({
      constraint: question.objective,
      questionIds: [question.id],
    })),
  }
}

export function reportResearchPlan(ctx: StageContext, plan: ResearchPlan): void {
  reportResearchPlanCard(
    ctx,
    plan.questions.map((question) => question.question)
  )
  reportResearchQuestionsRunning(ctx, plan.questions)
}

function validateResearchPlan(plan: ResearchPlan): readonly string[] {
  const issues: string[] = []

  if (plan.questions.length === 0) {
    issues.push('plan must have at least one question')
  }

  if (plan.coverage.length === 0) {
    issues.push('plan must have at least one coverage constraint')
  }

  issues.push(...duplicateQuestions(plan.questions))
  issues.push(...duplicateObjectives(plan.questions))
  issues.push(...overlappingObjectives(plan.questions))
  issues.push(...questionsWithTooFewSearchTerms(plan.questions))
  issues.push(...unresolvedCoverageIds(plan))
  issues.push(...uncoveredQuestionIds(plan))
  issues.push(...duplicateConstraints(plan.coverage))

  return issues
}

async function runPlanAttempt(
  ctx: StageContext,
  input: ResearchPlanningInput
): Promise<ResearchChildResult<ResearchPlan>> {
  if (ctx.invocation.signal.aborted) {
    return { kind: 'halted', reason: 'aborted', message: 'research aborted' }
  }

  const slices = ctx.budgets.take('plan', 1, 0)
  const slice = slices[0]

  if (slice === undefined) {
    return { kind: 'halted', reason: 'budget', message: 'insufficient budget for plan' }
  }

  return runSettledPlan({ ctx, planning: input, slice })
}

async function runSettledPlan(
  input: RunSettledPlanInput
): Promise<ResearchChildResult<ResearchPlan>> {
  try {
    return await input.ctx.stages.plan(input.planning, input.slice)
  } finally {
    input.slice.settle()
  }
}

function resolvePlanProfile(
  ctx: StageContext,
  input: ResearchPlanningInput,
  plan: ResearchPlan
): ResolvedPlanProfile {
  const objective = normalizeResearchObjective({
    query: input.query,
    depth: input.depth,
    allowPlannedObjective: input.allowObjectiveInference,
    planned: plan.objective,
    ...(ctx.request.freshness === undefined ? {} : { freshness: ctx.request.freshness }),
  })
  const effort = resolveResearchEffort({
    depth: input.depth,
    complexity: objective.complexity,
    maxQuestions: ctx.config.maxQuestions,
    maxBudgetedQuestions: ctx.maxBudgetedQuestions,
    maxReviewRounds: ctx.config.maxReviewRounds,
    maxParallelDelegations: ctx.maxParallelDelegations,
    availableDelegations: ctx.quota.spare(),
    reservedReviewRounds: ctx.effort.reviewRoundLimit,
  })

  return { plan: { ...plan, objective }, objective, effort }
}

function fallbackResearchPlan(input: ResearchPlanningInput): ResearchPlan {
  const question = fallbackQuestion(input.query)
  return {
    objective: input.deterministicObjective,
    questions: [question],
    coverage: [{ constraint: question.objective, questionIds: [question.id] }],
  }
}

function fallbackQuestion(query: string): ResearchQuestion {
  const normalized = truncateOnCodePoint(normalizeObjectiveText(query), MAX_QUESTION_CHARS)

  return createExactQueryQuestion('q1', query, [normalized, appendSearchQualifier(normalized)])
}

function repairSearchTerms(question: ResearchQuestion): readonly string[] {
  // The question's own wording leads: gather.ts keeps only the first maxSearchTermsPerQuestion
  // terms, so anything after the planner's own terms is silently never searched.
  const terms = [question.question, ...question.searchTerms]
    .map((term) => truncateOnCodePoint(normalizeObjectiveText(term), MAX_QUESTION_CHARS))
    .filter(Boolean)
  const distinct = [...new Set(terms)]

  if (distinct.length >= 2) {
    return distinct.slice(0, MAX_RESEARCH_LIST_ITEMS)
  }

  const first = distinct[0] ?? question.question
  return [first, appendSearchQualifier(first)]
}

function appendSearchQualifier(term: string): string {
  const prefix = truncateOnCodePoint(term, MAX_QUESTION_CHARS - SEARCH_QUALIFIER.length)
  return `${prefix}${SEARCH_QUALIFIER}`
}

function normalizePlanText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Alphabetic}\p{Number}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function duplicateQuestions(questions: readonly ResearchQuestion[]): readonly string[] {
  const seen = new Map<string, string>()
  const duplicates: string[] = []

  for (const q of questions) {
    const normalized = normalizePlanText(q.question)
    const existing = seen.get(normalized)
    if (existing !== undefined) {
      duplicates.push(`duplicate question: "${q.id}" has the same normalized text as "${existing}"`)
    } else {
      seen.set(normalized, q.id)
    }
  }

  return duplicates
}

function duplicateObjectives(questions: readonly ResearchQuestion[]): readonly string[] {
  const seen = new Map<string, string>()
  const duplicates: string[] = []

  for (const q of questions) {
    const normalized = normalizePlanText(q.objective)
    const existing = seen.get(normalized)
    if (existing !== undefined) {
      duplicates.push(
        `duplicate objective: "${q.id}" has the same normalized objective as "${existing}"`
      )
    } else {
      seen.set(normalized, q.id)
    }
  }

  return duplicates
}

function overlappingObjectives(questions: readonly ResearchQuestion[]): readonly string[] {
  const overlaps: string[] = []

  for (const [index, question] of questions.entries()) {
    for (const candidate of questions.slice(index + 1)) {
      const ratio = objectiveOverlapRatio(question.objective, candidate.objective)

      if (ratio > MAX_OBJECTIVE_OVERLAP_RATIO) {
        overlaps.push(
          `overlapping objectives: "${question.id}" and "${candidate.id}" share ${Math.round(ratio * 100)}% of objective tokens`
        )
      }
    }
  }

  return overlaps
}

function questionsWithTooFewSearchTerms(questions: readonly ResearchQuestion[]): readonly string[] {
  return questions
    .filter((question) => question.searchTerms.length < 2)
    .map((question) => `question "${question.id}" must have at least two search terms`)
}

function objectiveOverlapRatio(left: string, right: string): number {
  const leftTokens = tokenize(left)
  const rightTokens = tokenize(right)

  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0
  }

  let shared = 0
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      shared += 1
    }
  }

  return shared / Math.min(leftTokens.size, rightTokens.size)
}

function tokenize(text: string): ReadonlySet<string> {
  return new Set(normalizePlanText(text).split(TOKEN_RE).filter(Boolean))
}

function unresolvedCoverageIds(plan: ResearchPlan): readonly string[] {
  const questionIds = new Set(plan.questions.map((q) => q.id))
  const unresolved: string[] = []

  for (const c of plan.coverage) {
    for (const id of c.questionIds) {
      if (!questionIds.has(id)) {
        unresolved.push(`coverage references unknown question id "${id}"`)
      }
    }
  }

  return unresolved
}

function uncoveredQuestionIds(plan: ResearchPlan): readonly string[] {
  const covered = new Set(plan.coverage.flatMap((c) => c.questionIds))
  return plan.questions
    .filter((q) => !covered.has(q.id))
    .map((q) => `question "${q.id}" has no mapped constraint`)
}

function duplicateConstraints(
  coverage: readonly { readonly constraint: string; readonly questionIds: readonly string[] }[]
): readonly string[] {
  const seen = new Map<string, string>()
  const duplicates: string[] = []

  for (const c of coverage) {
    const normalized = normalizePlanText(c.constraint)
    const existing = seen.get(normalized)
    if (existing !== undefined) {
      duplicates.push(
        `duplicate constraint: same normalized text as constraint for question id="${existing}"`
      )
    } else {
      seen.set(normalized, c.questionIds[0] ?? '')
    }
  }

  return duplicates
}

import type { ResearchDepth } from '@/core/config/resolve'

import type { ResearchFreshness } from '../evidence/model'
import { researchBranchBudgetWeight } from '../budget'

const WHITESPACE_RE = /\s+/g
const ASSUMPTION_LABEL = 'Assumption: '
const ASSUMPTION_PREFIX_RE = /^assumption\s*:\s*/i
const STANDARD_REVIEW_ROUNDS = 1

/** One review plus the revision synthesis that answers it. */
export const CALLS_PER_REVIEW_ROUND = 2

export type ResearchComplexity = 'simple' | 'standard' | 'complex'

export interface ResearchObjective {
  readonly original: string
  readonly normalized: string
  readonly dimensions: readonly string[]
  readonly assumptions: readonly string[]
  readonly complexity: ResearchComplexity
  readonly freshness?: ResearchFreshness
}

export interface ResearchEffortProfile {
  readonly complexity: ResearchComplexity
  readonly questionLimit: number
  readonly reviewRoundLimit: number
  readonly branchBudgetWeight: number
}

interface NormalizeResearchObjectiveInput {
  readonly query: string
  readonly depth: ResearchDepth
  readonly allowPlannedObjective: boolean
  readonly freshness?: ResearchFreshness
  readonly planned?: ResearchObjective
}

interface ResolveResearchEffortInput {
  readonly depth: ResearchDepth
  readonly complexity: ResearchComplexity
  readonly maxQuestions: number
  readonly maxBudgetedQuestions: number
  readonly maxReviewRounds: number
  readonly maxParallelDelegations: number
  /** Calls the shared quota could still fund beyond what the run has reserved. */
  readonly availableDelegations: number
  /** Review rounds the run's reservation already pays for. */
  readonly reservedReviewRounds: number
}

function createDeterministicResearchObjective(
  query: string,
  freshness?: ResearchFreshness
): ResearchObjective {
  const normalized = normalizeObjectiveText(query)

  return {
    original: query,
    normalized,
    dimensions: [normalized],
    assumptions: [],
    complexity: 'standard',
    ...(freshness === undefined ? {} : { freshness }),
  }
}

export function normalizeResearchObjective(
  input: NormalizeResearchObjectiveInput
): ResearchObjective {
  const deterministic = createDeterministicResearchObjective(input.query, input.freshness)

  if (input.depth === 'light') {
    return { ...deterministic, complexity: 'simple' }
  }

  if (!input.allowPlannedObjective || input.planned === undefined) {
    return deterministic
  }

  return {
    original: input.query,
    normalized: normalizeObjectiveText(input.planned.normalized),
    dimensions: normalizeDistinct(input.planned.dimensions),
    assumptions: normalizeAssumptions(input.planned.assumptions),
    complexity: input.planned.complexity,
    ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
  }
}

export function resolveResearchEffort(input: ResolveResearchEffortInput): ResearchEffortProfile {
  if (input.depth === 'light') {
    return {
      complexity: 'simple',
      questionLimit: 1,
      reviewRoundLimit: 0,
      branchBudgetWeight: researchBranchBudgetWeight('light'),
    }
  }

  const complexity = input.complexity === 'complex' ? 'complex' : 'standard'
  const reviewRoundLimit = resolveReviewRoundLimit(input, complexity)
  const spareCalls = Math.max(0, Math.floor(input.availableDelegations))
  const reviewRoundCalls =
    Math.max(0, reviewRoundLimit - reservedRoundsOf(input)) * CALLS_PER_REVIEW_ROUND
  // The first question rides the run's own crawler reservation; only the rest draw on spare calls,
  // and the review rounds the reservation does not already pay for draw on them first.
  const delegationQuestionLimit = 1 + Math.max(0, spareCalls - reviewRoundCalls)
  const configuredQuestionLimit = Math.max(1, Math.floor(input.maxQuestions))
  const budgetQuestionLimit = Math.max(1, Math.floor(input.maxBudgetedQuestions))
  const boundedQuestionLimit = Math.min(
    configuredQuestionLimit,
    budgetQuestionLimit,
    delegationQuestionLimit
  )
  const parallelLimit = Math.max(1, Math.floor(input.maxParallelDelegations))
  const questionLimit =
    complexity === 'complex' ? boundedQuestionLimit : Math.min(boundedQuestionLimit, parallelLimit)

  return {
    complexity,
    questionLimit,
    reviewRoundLimit,
    branchBudgetWeight: researchBranchBudgetWeight(input.depth),
  }
}

export function normalizeObjectiveText(text: string): string {
  return text.trim().replace(WHITESPACE_RE, ' ')
}

function resolveReviewRoundLimit(
  input: ResolveResearchEffortInput,
  complexity: Exclude<ResearchComplexity, 'simple'>
): number {
  const configured = Math.max(0, Math.floor(input.maxReviewRounds))
  const wanted =
    input.depth === 'medium' || complexity === 'standard'
      ? Math.min(configured, STANDARD_REVIEW_ROUNDS)
      : configured
  const spareRounds = Math.floor(Math.max(0, input.availableDelegations) / CALLS_PER_REVIEW_ROUND)

  return Math.min(wanted, reservedRoundsOf(input) + spareRounds)
}

function reservedRoundsOf(input: ResolveResearchEffortInput): number {
  return Math.max(0, Math.floor(input.reservedReviewRounds))
}

function normalizeDistinct(values: readonly string[]): readonly string[] {
  const normalized = values.map(normalizeObjectiveText).filter(Boolean)
  return [...new Set(normalized)]
}

function normalizeAssumptions(values: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const value of values) {
    const canonical = canonicalizeAssumption(value)
    const key = canonical.toLowerCase()

    if (canonical !== '' && !seen.has(key)) {
      seen.add(key)
      normalized.push(canonical)
    }
  }
  return normalized
}

function canonicalizeAssumption(value: string): string {
  const normalized = normalizeObjectiveText(value)
  const body = normalized.replace(ASSUMPTION_PREFIX_RE, '').trim()

  return body === '' ? '' : `${ASSUMPTION_LABEL}${body}`
}

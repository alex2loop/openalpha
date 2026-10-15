import type { z } from 'zod'

import type { JsonOutputContract } from '@/core/llm'
import type { BudgetSlice } from '@/engine/types/cost'

import type {
  ResearchChildResult,
  ResearchRole,
  ResearchStageDeps,
  ResearchStages,
} from '../contracts'
import type {
  FlatResearchBranch,
  ResearchEvidenceBranch,
  ResearchQuestion,
} from '../evidence/schemas'
import type { GatherResult, ResearchOperationReport } from '../retrieval/types'
import {
  MAX_GAP_VALUE_ITEM_CHARS,
  MAX_GAPS,
  MAX_RETRIEVAL_ATTEMPTS,
  RESEARCH_CRAWLER_ID,
} from '../contracts'
import { logBranchEvidence, logRetrievalGaps } from '../diagnostics'
import { gatherGapSignature } from '../evidence/gaps'
import { toResearchOutputContract } from '../evidence/parse'
import { salvageReportCandidate } from '../evidence/salvage'
import {
  FlatResearchBranchSchema,
  ResearchPlanSchema,
  ResearchReportCandidateSchema,
  ResearchReviewSchema,
  salvageFlatBranch,
} from '../evidence/schemas'
import { gatherSources } from '../retrieval/gather'
import { createRetrievalCache, type RetrievalCache } from '../retrieval/state'
import { type ChildSalvage, runResearchChild } from './children'
import { toEvidenceBranch } from './flat-branch'
import { crawlPrompt, planPrompt, reviewPrompt, synthesisPrompt } from './prompts'
import { abortedResult } from './runs'

const NO_SOURCES_BRANCH: FlatResearchBranch = Object.freeze({ claims: [], gaps: [] })

const OUTPUT_CONTRACTS = Object.freeze({
  'research-planner': toResearchOutputContract('research_plan', ResearchPlanSchema),
  [RESEARCH_CRAWLER_ID]: toResearchOutputContract('research_branch', FlatResearchBranchSchema),
  'research-synthesizer': toResearchOutputContract(
    'research_report_candidate',
    ResearchReportCandidateSchema
  ),
  'research-reviewer': toResearchOutputContract('research_review', ResearchReviewSchema),
} satisfies Readonly<Record<ResearchRole, JsonOutputContract>>)

export function createResearchStages(deps: ResearchStageDeps): ResearchStages {
  const cacheEntries = deps.researchConfig.maxQuestions * (deps.researchConfig.maxReviewRounds + 1)
  const cache = createRetrievalCache(cacheEntries, (attempts) =>
    appendRetrievalAttempts(deps, attempts)
  )

  return {
    plan: (input, budget, correctionIssues) =>
      runStage(deps, {
        role: 'research-planner',
        prompt: planPrompt(input, correctionIssues),
        schema: ResearchPlanSchema,
        outputContract: OUTPUT_CONTRACTS['research-planner'],
        budget,
      }),
    crawl: (question, options) =>
      runCrawlerStage({
        deps,
        cache,
        question,
        budget: options.budget,
        ...(options.correctionIssues === undefined
          ? {}
          : { correctionIssues: options.correctionIssues }),
        ...(options.reportOperation === undefined
          ? {}
          : { reportOperation: options.reportOperation }),
      }),
    crawlFresh: (question, budget) =>
      runCrawlerStage({ deps, cache, question, budget, forceFresh: true }),
    classifySubquery: deps.retrievalState.classifySubquery,
    synthesize: (input, budget, correctionIssues) =>
      runStage(deps, {
        role: 'research-synthesizer',
        prompt: synthesisPrompt(input, correctionIssues),
        schema: ResearchReportCandidateSchema,
        outputContract: OUTPUT_CONTRACTS['research-synthesizer'],
        budget,
        salvage: (raw) => salvageReportCandidate(raw, input.evidence),
      }),
    review: (input, budget, correctionIssues) =>
      runStage(deps, {
        role: 'research-reviewer',
        prompt: reviewPrompt(input, correctionIssues),
        schema: ResearchReviewSchema,
        outputContract: OUTPUT_CONTRACTS['research-reviewer'],
        budget,
      }),
    dispose: cache.dispose,
  }
}

interface RunCrawlerStageInput {
  readonly deps: ResearchStageDeps
  readonly cache: RetrievalCache
  readonly question: ResearchQuestion
  readonly budget: BudgetSlice
  readonly correctionIssues?: readonly string[]
  readonly forceFresh?: boolean
  readonly reportOperation?: (report: ResearchOperationReport) => void
}

async function runCrawlerStage(
  input: RunCrawlerStageInput
): Promise<ResearchChildResult<ResearchEvidenceBranch>> {
  const { deps, cache, question, budget, correctionIssues } = input
  const cached = input.forceFresh === true ? undefined : cache.get(question.id)
  // A gather that found nothing is not worth serving again: a retry searches afresh.
  const gathered =
    cached !== undefined && cached.sources.length > 0 ? cached : await gatherForQuestion(input)
  // With no sources there is nothing for the crawler to read, so no call is spent asking it.
  const result: ResearchChildResult<FlatResearchBranch> =
    gathered.sources.length === 0
      ? { kind: 'value', value: NO_SOURCES_BRANCH }
      : await runStage(deps, {
          role: RESEARCH_CRAWLER_ID,
          questionId: question.id,
          prompt: crawlPrompt({
            deps,
            question,
            gathered,
            ...(correctionIssues === undefined ? {} : { correctionIssues }),
          }),
          schema: FlatResearchBranchSchema,
          outputContract: OUTPUT_CONTRACTS[RESEARCH_CRAWLER_ID],
          budget,
          salvage: salvageFlatBranch,
        })
  const mapped = mapChildResult(result, (flat) =>
    toEvidenceBranch({
      questionId: question.id,
      branch: flat,
      material: gathered,
      researchConfig: deps.researchConfig,
      logger: deps.logger,
    })
  )
  const merged = mergeGatherGaps(mapped, gathered)
  if (merged.kind !== 'value' && gathered.gaps.length > 0) {
    logRetrievalGaps(deps.logger, { questionId: question.id, gaps: gathered.gaps })
  }

  return mapChildResult(merged, (branch) => {
    logBranchEvidence(deps.logger, { phase: 'crawl', questionId: question.id, branch })
    return branch
  })
}

async function gatherForQuestion(input: RunCrawlerStageInput): Promise<GatherResult> {
  const { deps, cache, question } = input
  const order = cache.reserveOrder()
  const observedAttempts: ResearchStageDeps['retrievalAttempts'][number][] = []
  let completed = false

  try {
    const gathered = await gatherSources({
      query: question.question,
      queries: question.searchTerms,
      maxQueries: deps.researchConfig.maxSearchTermsPerQuestion,
      questionId: question.id,
      locale: deps.invocation.locale,
      now: deps.now,
      retrieval: deps.retrieval,
      state: deps.retrievalState,
      config: deps.researchConfig,
      invocation: { ...deps.invocation, recordExternalCost: deps.recordExternalCost },
      observeAttempt: (attempt) => observedAttempts.push(attempt),
      ...(input.reportOperation === undefined ? {} : { reportOperation: input.reportOperation }),
      ...(deps.freshness === undefined ? {} : { freshness: deps.freshness }),
    })

    cache.complete(order, gathered.attempts)
    completed = true
    cache.put(question.id, gathered)
    return gathered
  } catch (error: unknown) {
    if (!completed) {
      cache.complete(order, observedAttempts)
    }
    throw error
  }
}

function appendRetrievalAttempts(
  deps: ResearchStageDeps,
  attempts: readonly ResearchStageDeps['retrievalAttempts'][number][]
): void {
  const available = MAX_RETRIEVAL_ATTEMPTS - deps.retrievalAttempts.length
  deps.retrievalAttempts.push(...attempts.slice(0, Math.max(0, available)))
}

interface RunStageInput<T> {
  readonly role: ResearchRole
  readonly questionId?: string
  readonly prompt: string
  readonly schema: z.ZodType<T>
  readonly outputContract: JsonOutputContract
  readonly budget: BudgetSlice
  readonly salvage?: ChildSalvage<T>
}

async function runStage<T>(
  deps: ResearchStageDeps,
  input: RunStageInput<T>
): Promise<ResearchChildResult<T>> {
  if (deps.invocation.signal.aborted) {
    return abortedResult()
  }

  deps.quota.claim()
  return runResearchChild(deps.runner, {
    role: input.role,
    prompt: input.prompt,
    schema: input.schema,
    outputContract: input.outputContract,
    budget: input.budget,
    invocation: deps.invocation,
    logger: deps.logger,
    ...(input.questionId === undefined ? {} : { questionId: input.questionId }),
    ...(input.salvage === undefined ? {} : { salvage: input.salvage }),
  })
}

function mapChildResult<A, B>(
  result: ResearchChildResult<A>,
  map: (value: A) => B
): ResearchChildResult<B> {
  return result.kind === 'value' ? { ...result, value: map(result.value) } : result
}

function mergeGatherGaps(
  result: ResearchChildResult<ResearchEvidenceBranch>,
  gathered: GatherResult
): ResearchChildResult<ResearchEvidenceBranch> {
  if (result.kind !== 'value') {
    return result
  }

  const existing = new Set(result.value.gaps.map(gatherGapSignature))
  const additions = gathered.gaps
    .filter((gap) => !existing.has(gatherGapSignature(gap)))
    .map((gap) => ({
      code: gap.code,
      claimRefs: [],
      excerptRefs: [],
      sourceRefs: [],
      values: gap.values.map((value) => value.slice(0, MAX_GAP_VALUE_ITEM_CHARS)),
      ...(gap.params === undefined ? {} : { params: gap.params }),
      message: gap.message,
    }))
  const gaps = [...result.value.gaps, ...additions].slice(0, MAX_GAPS)

  return { ...result, value: { ...result.value, gaps } }
}

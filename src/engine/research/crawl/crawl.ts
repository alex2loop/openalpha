import type { BudgetSlice } from '@/engine/types/cost'
import { RunHalted } from '@/core/errors'

import type {
  ResearchBranchSuccess,
  ResearchBudgetPool,
  ResearchChildResult,
  ResearchFailure,
  ResearchQuota,
  ResearchStages,
} from '../contracts'
import type {
  ResearchProgress,
  ResearchReviewFollowupProgress,
  ResearchStageState,
} from '../events'
import type { ResearchEvidenceBranch, ResearchQuestion } from '../evidence/schemas'
import { QUOTA_EXHAUSTED_MESSAGE } from '../contracts'
import {
  type CrawlFailureContext,
  type CrawlFailureDetails,
  crawlFailureFromResult,
  createCrawlFailure,
  hasRunHalt,
  isRetryableFailure,
  rejectedFailureDetails,
  retryableIndices,
} from './failures'
import {
  reportResearchBranchComplete,
  reportResearchBranchFailure,
  reportResearchBranchOperation,
  reportResearchBranchRetry,
} from './progress'

type CrawlCorrectionPolicy = 'correct_once' | 'none'

export interface CrawlQuestionsDeps {
  readonly stages: ResearchStages
  readonly quota: ResearchQuota
  readonly budgets: ResearchBudgetPool
  readonly signal: AbortSignal
  readonly maxParallelDelegations: number
  readonly reportProgress?: (message: ResearchProgress) => void
  readonly reportStage?: (state: ResearchStageState) => void
  readonly correctionPolicy?: CrawlCorrectionPolicy
  readonly reviewFollowup?: ResearchReviewFollowupProgress
}

export interface CrawlSummary {
  readonly successes: readonly ResearchBranchSuccess[]
  readonly failures: readonly ResearchFailure[]
}

interface CrawlState {
  readonly successes: Array<ResearchBranchSuccess | undefined>
  readonly failures: Map<number, ResearchFailure>
  readonly completed: Set<number>
  readonly attempts: Map<number, number>
  readonly elapsedMs: Map<number, number>
}

interface CrawlWork {
  readonly deps: CrawlQuestionsDeps
  readonly questions: readonly ResearchQuestion[]
  readonly state: CrawlState
}

type CrawlAttempt = 'initial' | 'retry'

interface CrawlBatch {
  readonly work: CrawlWork
  readonly indices: readonly number[]
  readonly slices: readonly BudgetSlice[]
  readonly attempt: CrawlAttempt
}

interface SettledCrawlAttemptInput {
  readonly work: CrawlWork
  readonly questionIndex: number
  readonly slice: BudgetSlice | undefined
  readonly attempt: CrawlAttempt
}

type CrawlAttemptOutcome =
  | {
      readonly kind: 'settled'
      readonly result: ResearchChildResult<ResearchEvidenceBranch>
      readonly elapsedMs: number
    }
  | { readonly kind: 'rejected'; readonly reason: unknown; readonly elapsedMs: number }

export async function crawlQuestions(
  deps: CrawlQuestionsDeps,
  questions: readonly ResearchQuestion[]
): Promise<CrawlSummary> {
  const state = createCrawlState(questions.length)
  const initialIndices = questions.map((_, index) => index)
  const work = { deps, questions, state }
  const mainCrawl = (deps.correctionPolicy ?? 'correct_once') !== 'none'

  if (deps.signal.aborted) {
    recordAborted(work, initialIndices)
    return toSummary(state)
  }

  if (mainCrawl) {
    reportCrawlProgress(work)
  }
  await runCrawlBatches(work, initialIndices, 'initial')

  if (hasRunHalt(state.failures) || !mainCrawl) {
    return toSummary(state)
  }

  const retryIndices = reserveRetrySlots(work, retryableIndices(state.failures))

  if (deps.signal.aborted) {
    recordAborted(work, retryIndices)
    return toSummary(state)
  }

  await runCrawlBatches(work, retryIndices, 'retry')
  reportCrawlSettled(work, state)
  return toSummary(state)
}

function createCrawlState(questionCount: number): CrawlState {
  return {
    successes: Array.from({ length: questionCount }),
    failures: new Map(),
    completed: new Set(),
    attempts: new Map(),
    elapsedMs: new Map(),
  }
}

async function runCrawlBatches(
  work: CrawlWork,
  indices: readonly number[],
  attempt: CrawlAttempt
): Promise<void> {
  const batchSize = Math.max(1, Math.min(indices.length, work.deps.maxParallelDelegations))

  for (let offset = 0; offset < indices.length; offset += batchSize) {
    if (work.deps.signal.aborted) {
      recordAborted(work, indices.slice(offset))
      return
    }

    const batch = indices.slice(offset, offset + batchSize)
    const futureCalls = indices.length - offset - batch.length
    const slices = work.deps.budgets.take('crawl', batch.length, futureCalls)

    if (slices.length !== batch.length) {
      settleSlices(slices)
      recordBudgetFailures(work, batch)
      continue
    }

    if (await runCrawlBatch({ work, indices: batch, slices, attempt })) {
      recordBudgetFailures(work, indices.slice(offset + batch.length))
      return
    }
  }
}

/** Resolves true when a member exhausted the budget: remaining batches cannot be funded. */
async function runCrawlBatch(input: CrawlBatch): Promise<boolean> {
  const { work, indices, slices, attempt } = input
  const halts = await Promise.all(
    indices.map((questionIndex, sliceIndex) =>
      runSettledCrawlAttempt({
        work,
        questionIndex,
        slice: slices[sliceIndex],
        attempt,
      })
    )
  )

  return halts.some((halted) => halted)
}

async function runSettledCrawlAttempt(input: SettledCrawlAttemptInput): Promise<boolean> {
  const { work, questionIndex, slice, attempt } = input
  let outcome: CrawlAttemptOutcome

  try {
    outcome = await runCrawlAttempt(work, questionIndex, slice)
  } finally {
    slice?.settle()
  }

  recordAttempt(work.state, questionIndex, outcome.elapsedMs)
  applyCrawlOutcome(work, questionIndex, outcome)
  markCompleted(work.state, [questionIndex], attempt)
  reportSettledBranch(work, questionIndex)
  return isBudgetHalt(outcome)
}

function isBudgetHalt(outcome: CrawlAttemptOutcome): boolean {
  return (
    outcome.kind === 'rejected' &&
    outcome.reason instanceof RunHalted &&
    outcome.reason.code === 'budget'
  )
}

function reportSettledBranch(work: CrawlWork, index: number): void {
  const question = work.questions[index]

  if (question === undefined || !work.state.completed.has(index)) {
    return
  }

  const success = work.state.successes[index]
  const position = { question, index: index + 1, total: work.questions.length, ...followup(work) }

  if (success !== undefined) {
    reportResearchBranchComplete(work.deps.reportProgress, { ...position, success })
    return
  }

  const item = work.state.failures.get(index)
  if (item !== undefined) {
    reportResearchBranchFailure(work.deps.reportProgress, { ...position, failure: item })
  }
}

function followup(work: CrawlWork): {
  readonly reviewFollowup?: ResearchReviewFollowupProgress
} {
  return work.deps.reviewFollowup === undefined ? {} : { reviewFollowup: work.deps.reviewFollowup }
}

async function runCrawlAttempt(
  work: CrawlWork,
  questionIndex: number,
  slice: BudgetSlice | undefined
): Promise<CrawlAttemptOutcome> {
  const question = work.questions[questionIndex]
  const startedAt = performance.now()

  if (question === undefined || slice === undefined) {
    return { kind: 'settled', result: budgetResult(), elapsedMs: 0 }
  }

  const priorFailure = work.state.failures.get(questionIndex)
  const correctionIssues = priorFailure === undefined ? undefined : toCorrectionIssues(priorFailure)

  try {
    const result = await work.deps.stages.crawl(question, {
      budget: slice,
      reportOperation: (operation) =>
        reportResearchBranchOperation(work.deps.reportProgress, {
          question,
          index: questionIndex + 1,
          total: work.questions.length,
          operation,
          ...followup(work),
        }),
      ...(correctionIssues === undefined ? {} : { correctionIssues }),
    })
    return { kind: 'settled', result, elapsedMs: performance.now() - startedAt }
  } catch (reason: unknown) {
    return { kind: 'rejected', reason, elapsedMs: performance.now() - startedAt }
  }
}

function toCorrectionIssues(priorFailure: ResearchFailure): readonly string[] {
  const detail = priorFailure.correctionIssues ?? [priorFailure.message]
  return priorFailure.haltCode === undefined ? detail : [priorFailure.haltCode, ...detail]
}

function recordAttempt(state: CrawlState, index: number, elapsedMs: number): void {
  state.attempts.set(index, (state.attempts.get(index) ?? 0) + 1)
  state.elapsedMs.set(index, (state.elapsedMs.get(index) ?? 0) + elapsedMs)
}

function applyCrawlOutcome(work: CrawlWork, index: number, outcome: CrawlAttemptOutcome): void {
  if (outcome.kind === 'rejected') {
    work.state.failures.set(index, failure(work, index, rejectedFailureDetails(outcome.reason)))
    return
  }

  applyCrawlResult(work, index, outcome.result)
}

function applyCrawlResult(
  work: CrawlWork,
  index: number,
  result: ResearchChildResult<ResearchEvidenceBranch>
): void {
  const question = work.questions[index]

  if (question === undefined) {
    return
  }

  if (result.kind === 'value' && result.value.questionId === question.id) {
    if (result.value.claims.length > 0) {
      work.state.successes[index] = {
        branch: result.value,
        attempts: work.state.attempts.get(index) ?? 1,
        elapsedMs: work.state.elapsedMs.get(index) ?? 0,
        ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
      }
      work.state.failures.delete(index)
      return
    }

    work.state.failures.set(
      index,
      failure(work, index, {
        code: 'source_unavailable',
        message: result.value.gaps[0]?.message ?? 'crawler returned no claims',
        sources: result.value.sources.length,
        ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
      })
    )
    return
  }

  work.state.failures.set(index, crawlFailureFromResult(result, failureContext(work, index)))
}

function reserveRetrySlots(work: CrawlWork, indices: readonly number[]): readonly number[] {
  const admitted: number[] = []

  for (const index of indices) {
    if (work.deps.signal.aborted) {
      break
    }

    if (work.deps.quota.reserveUpTo(1) === 0) {
      work.state.failures.set(
        index,
        failure(work, index, { code: 'capacity_exhausted', message: QUOTA_EXHAUSTED_MESSAGE })
      )
      work.state.completed.add(index)
      reportSettledBranch(work, index)
      continue
    }

    admitted.push(index)

    const question = work.questions[index]

    if (question !== undefined) {
      reportResearchBranchRetry(work.deps.reportProgress, {
        question,
        index: index + 1,
        total: work.questions.length,
        attempt: (work.state.attempts.get(index) ?? 0) + 1,
        ...followup(work),
      })
    }
  }

  return admitted
}

function markCompleted(state: CrawlState, indices: readonly number[], attempt: CrawlAttempt): void {
  for (const index of indices) {
    const item = state.failures.get(index)
    const terminal =
      attempt === 'retry' ||
      state.successes[index] !== undefined ||
      (item !== undefined && !isRetryableFailure(item))

    if (terminal) {
      state.completed.add(index)
    }
  }
}

function recordAborted(work: CrawlWork, indices: readonly number[]): void {
  recordTerminalFailures(work, indices, { code: 'aborted', message: 'research aborted' })
}

function recordBudgetFailures(work: CrawlWork, indices: readonly number[]): void {
  recordTerminalFailures(work, indices, {
    code: 'budget_exhausted',
    message: 'insufficient budget for crawl',
  })
}

function recordTerminalFailures(
  work: CrawlWork,
  indices: readonly number[],
  details: CrawlFailureDetails
): void {
  for (const index of indices) {
    work.state.failures.set(index, failure(work, index, details))
    work.state.completed.add(index)
    reportSettledBranch(work, index)
  }
}

function failure(work: CrawlWork, index: number, details: CrawlFailureDetails): ResearchFailure {
  return createCrawlFailure(failureContext(work, index), details)
}

function failureContext(work: CrawlWork, index: number): CrawlFailureContext {
  const question = work.questions[index]

  return {
    ...(question === undefined ? {} : { questionId: question.id }),
    attempts: work.state.attempts.get(index) ?? 0,
    elapsedMs: work.state.elapsedMs.get(index) ?? 0,
  }
}

function reportCrawlProgress(work: CrawlWork): void {
  if (!work.deps.signal.aborted) {
    work.deps.reportStage?.('running')
  }
}

function reportCrawlSettled(work: CrawlWork, state: CrawlState): void {
  if (!work.deps.signal.aborted) {
    work.deps.reportStage?.(
      state.successes.some((success) => success !== undefined) ? 'complete' : 'failed'
    )
  }
}

function budgetResult(): ResearchChildResult<ResearchEvidenceBranch> {
  return { kind: 'halted', reason: 'budget', message: 'insufficient budget for crawl' }
}

function settleSlices(slices: readonly BudgetSlice[]): void {
  for (const slice of slices) {
    slice.settle()
  }
}

function toSummary(state: CrawlState): CrawlSummary {
  return {
    successes: state.successes.filter(
      (success): success is ResearchBranchSuccess => success !== undefined
    ),
    failures: [...state.failures.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item),
  }
}

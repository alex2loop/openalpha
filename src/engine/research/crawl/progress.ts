import type { ResearchBranchSuccess, ResearchFailure } from '../contracts'
import type { ResearchProgress, ResearchReviewFollowupProgress } from '../events'
import type { ResearchQuestion } from '../evidence/schemas'
import type { ResearchOperationReport } from '../retrieval/types'

type ReportProgress = ((message: ResearchProgress) => void) | undefined

interface QuestionPosition {
  readonly question: ResearchQuestion
  readonly index: number
  readonly total: number
  readonly reviewFollowup?: ResearchReviewFollowupProgress
}

interface BranchRetryInput extends QuestionPosition {
  readonly attempt: number
}

interface BranchCompleteInput extends QuestionPosition {
  readonly success: ResearchBranchSuccess
}

interface BranchFailureInput extends QuestionPosition {
  readonly failure: ResearchFailure
}

interface BranchOperationInput extends QuestionPosition {
  readonly operation: ResearchOperationReport
}

export function reportResearchBranchOperation(
  report: ReportProgress,
  input: BranchOperationInput
): void {
  report?.({
    key: 'progress.researchQuestion',
    params: {
      ...questionParams(input),
      state: 'running',
      operation: input.operation.operation,
      detail: input.operation.detail,
      ...(input.operation.pageCount === undefined ? {} : { pageCount: input.operation.pageCount }),
    },
  })
}

export function reportResearchBranchRetry(report: ReportProgress, input: BranchRetryInput): void {
  report?.({
    key: 'progress.researchQuestion',
    params: { ...questionParams(input), state: 'running', attempts: input.attempt },
  })
}

export function reportResearchBranchComplete(
  report: ReportProgress,
  input: BranchCompleteInput
): void {
  report?.({
    key: 'progress.researchQuestion',
    params: {
      ...questionParams(input),
      state: 'complete',
      elapsedMs: Math.round(input.success.elapsedMs),
      attempts: input.success.attempts,
      extractedClaims: input.success.branch.claims.length,
      candidateSources: input.success.branch.sources.length,
    },
  })
}

export function reportResearchBranchFailure(
  report: ReportProgress,
  input: BranchFailureInput
): void {
  report?.({
    key: 'progress.researchQuestion',
    params: {
      ...questionParams(input),
      state: 'failed',
      elapsedMs: Math.round(input.failure.elapsedMs),
      attempts: input.failure.attempts,
      failureCode: input.failure.code,
    },
  })
}

function questionParams(input: QuestionPosition): {
  readonly questionId: string
  readonly question: string
  readonly index: number
  readonly total: number
  readonly reviewFollowup?: ResearchReviewFollowupProgress
} {
  return {
    questionId: input.question.id,
    question: input.question.question,
    index: input.index,
    total: input.total,
    ...(input.reviewFollowup === undefined ? {} : { reviewFollowup: input.reviewFollowup }),
  }
}

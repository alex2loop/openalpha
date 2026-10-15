import type { ResearchFailure, ResearchFailureCode } from '../contracts'
import type { CrawlSummary } from '../crawl/crawl'
import type { ResearchQuestion } from '../evidence/schemas'
import type { StageContext } from '../stages/funnel'
import { MAX_QUESTION_CHARS, QUOTA_EXHAUSTED_MESSAGE } from '../contracts'
import { crawlQuestions } from '../crawl/crawl'
import { createCrawlFailure } from '../crawl/failures'
import { truncateOnCodePoint } from '../evidence/normalize'
import { normalizeObjectiveText } from '../planning/profile'
import { crawlDeps, reportResearchQuestionRunning } from '../stages/funnel'

const FALLBACK_QUESTION_ID = 'fallback'
const FALLBACK_ELIGIBLE_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'source_unavailable',
  'invalid_tool_arguments',
  'invalid_output',
  'timeout',
  'turn_limit',
  'provider_unavailable',
  'llm_provider_failed',
])

export function isFallbackEligible(failures: readonly ResearchFailure[]): boolean {
  return (
    failures.length > 0 && failures.every((failure) => FALLBACK_ELIGIBLE_CODES.has(failure.code))
  )
}

export async function runExactQueryFallback(ctx: StageContext): Promise<CrawlSummary> {
  const question = createExactQueryQuestion(FALLBACK_QUESTION_ID, ctx.request.query)

  // An unfunded retry is skipped, not claimed against the calls set aside for synthesis and review.
  if (ctx.quota.reserveUpTo(1) === 0) {
    const context = { questionId: question.id, attempts: 0, elapsedMs: 0 }
    const details = { code: 'capacity_exhausted', message: QUOTA_EXHAUSTED_MESSAGE } as const

    return { successes: [], failures: [createCrawlFailure(context, details)] }
  }

  reportResearchQuestionRunning(ctx, question, { index: 1, total: 1, fallback: true })

  return crawlQuestions({ ...crawlDeps(ctx), correctionPolicy: 'none' }, [question])
}

/**
 * The one exact-question factory: the planner's fallback plan and the exact-query retry both build
 * their question here. Text is bounded to the same limit the plan schema enforces on planner
 * questions, so a very long operator query cannot produce an unbounded one.
 */
export function createExactQueryQuestion(
  id: string,
  query: string,
  searchTerms?: readonly string[]
): ResearchQuestion {
  const normalized = truncateOnCodePoint(normalizeObjectiveText(query), MAX_QUESTION_CHARS)

  return {
    id,
    question: normalized,
    objective: normalized,
    searchTerms: searchTerms ?? [normalized],
    preferredSourceKinds: ['official'],
  }
}

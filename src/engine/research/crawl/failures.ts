import type { HaltCode } from '@/core/errors'
import { RunHalted, ToolError } from '@/core/errors'

import type { ResearchChildResult, ResearchFailure, ResearchFailureCode } from '../contracts'
import type { ResearchEvidenceBranch } from '../evidence/schemas'
import { MAX_RESEARCH_ERROR_CHARS } from '../contracts'
import { invalidResearchChildMessage } from '../stages/children'

const HALTED_CRAWL_CODES = {
  aborted: 'aborted',
  budget: 'budget_exhausted',
  timeout: 'timeout',
  turn_limit: 'turn_limit',
  loop: 'loop_detected',
  error: 'llm_provider_failed',
} as const satisfies Record<string, ResearchFailureCode>
// Thrown RunHalted codes with a canonical crawl-failure analog. Unlisted codes fall back to
// 'unexpected' but keep haltCode so the one bounded correction retry can act on it.
const THROWN_HALT_CODES: Partial<Record<HaltCode, ResearchFailureCode>> = {
  abort: 'aborted',
  shutdown: 'aborted',
  budget: 'budget_exhausted',
  queue_full: 'capacity_exhausted',
  turn_limit: 'turn_limit',
  loop: 'loop_detected',
  llm_error: 'llm_provider_failed',
  rate: 'llm_provider_failed',
}

export interface CrawlFailureContext {
  readonly questionId?: string
  readonly attempts: number
  readonly elapsedMs: number
}

export interface CrawlFailureDetails {
  readonly code: ResearchFailureCode
  readonly message: string
  readonly claims?: number
  readonly sources?: number
  readonly providerModel?: ResearchFailure['providerModel']
  readonly haltCode?: ResearchFailure['haltCode']
  readonly correctionIssues?: readonly string[]
}

export function createCrawlFailure(
  context: CrawlFailureContext,
  details: CrawlFailureDetails
): ResearchFailure {
  return {
    code: details.code,
    stage: 'crawl',
    message: details.message.slice(0, MAX_RESEARCH_ERROR_CHARS),
    ...(context.questionId === undefined ? {} : { questionId: context.questionId }),
    attempts: context.attempts,
    elapsedMs: context.elapsedMs,
    claims: details.claims ?? 0,
    sources: details.sources ?? 0,
    ...(details.providerModel === undefined ? {} : { providerModel: details.providerModel }),
    ...(details.haltCode === undefined ? {} : { haltCode: details.haltCode }),
    ...(details.correctionIssues === undefined
      ? {}
      : { correctionIssues: details.correctionIssues }),
  }
}

/** The one thrown-rejection to failure mapping: anything unmapped stays retryable 'unexpected'. */
export function rejectedFailureDetails(reason: unknown): CrawlFailureDetails {
  if (reason instanceof RunHalted) {
    return {
      code: THROWN_HALT_CODES[reason.code] ?? 'unexpected',
      message: reason.message,
      haltCode: reason.code,
    }
  }

  // A quota refusal is terminal: retrying it only spends another round to be refused again.
  if (reason instanceof ToolError && reason.code === 'delegate_full') {
    return { code: 'capacity_exhausted', message: reason.message }
  }

  return { code: 'unexpected', message: 'research crawler failed unexpectedly' }
}

/** The one child-result to failure mapping; every crawl failure code is decided here. */
export function crawlFailureFromResult(
  result: ResearchChildResult<ResearchEvidenceBranch>,
  context: CrawlFailureContext
): ResearchFailure {
  return createCrawlFailure(context, failureDetails(result))
}

function failureDetails(result: ResearchChildResult<ResearchEvidenceBranch>): CrawlFailureDetails {
  const providerModel =
    result.providerModel === undefined ? {} : { providerModel: result.providerModel }

  switch (result.kind) {
    case 'invalid':
      return {
        code: 'invalid_output',
        message: invalidResearchChildMessage(result.issues),
        ...(result.issues.length === 0 ? {} : { correctionIssues: result.issues }),
        ...providerModel,
      }
    case 'incompatible':
      return {
        code: 'model_incompatible',
        message: result.message,
        providerModel: result.providerModel,
      }
    case 'invalid_tool_arguments':
      return { code: 'invalid_tool_arguments', message: result.message, ...providerModel }
    case 'halted':
      return {
        code: HALTED_CRAWL_CODES[result.reason],
        message: result.message,
        ...providerModel,
        ...(result.haltCode === undefined ? {} : { haltCode: result.haltCode }),
      }
    case 'value':
      return {
        code: 'invalid_output',
        message: 'crawler returned a mismatched question id',
        claims: result.value.claims.length,
        sources: result.value.sources.length,
        ...providerModel,
      }
  }
}

const HALTED_CRAWL_FAILURE_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'timeout',
  'turn_limit',
  'llm_provider_failed',
])
const TERMINAL_CRAWL_FAILURE_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'aborted',
  'budget_exhausted',
  'capacity_exhausted',
  'loop_detected',
  'model_incompatible',
])
// Run-level halts: one question hitting these leaves nothing to fund a sibling retry with.
const RUN_HALTING_FAILURE_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'aborted',
  'budget_exhausted',
])

export function retryableIndices(
  failures: ReadonlyMap<number, ResearchFailure>
): readonly number[] {
  return [...failures.entries()]
    .filter(([, item]) => isRetryableFailure(item))
    .map(([index]) => index)
}

export function isRetryableFailure(item: ResearchFailure): boolean {
  if (item.providerModel === undefined && HALTED_CRAWL_FAILURE_CODES.has(item.code)) {
    return false
  }

  return !TERMINAL_CRAWL_FAILURE_CODES.has(item.code)
}

// Run-level halts: one question hitting these leaves nothing to fund a sibling retry with.
export function hasRunHalt(failures: ReadonlyMap<number, ResearchFailure>): boolean {
  return [...failures.values()].some((item) => RUN_HALTING_FAILURE_CODES.has(item.code))
}

import type {
  FailedResearchResult,
  ResearchChildResult,
  ResearchEvidenceLevel,
  ResearchFailure,
  ResearchFailureCode,
  ResearchResult,
  ResearchReview,
} from './contracts'
import type { EvidenceDisposition } from './evidence/disposition'
import type { AdmittedEvidence, ResearchArtifact, ResearchReport } from './evidence/model'
import { MAX_RESEARCH_ERROR_CHARS } from './contracts'
import { toResearchIssueSummaries } from './display/issue-summary'
import { boundEvidenceToArtifactLimit } from './evidence/disposition'
import { addResearchGap } from './evidence/gaps'
import { invalidResearchChildMessage } from './stages/children'
import {
  type AdmitCrawlEvidenceInput,
  admitCrawlEvidence,
  artifactBytes,
  buildArtifact,
  evidenceHeadroomBytes,
  type StageContext,
} from './stages/funnel'

const PROVIDER_UNAVAILABLE_CODES: ReadonlySet<ResearchFailureCode> = new Set([
  'llm_provider_failed',
  'provider_unavailable',
  'source_unavailable',
])
const STAGE_FAILURE_CODES = {
  plan: 'planner_failed',
  synthesize: 'synthesizer_failed',
  review: 'reviewer_incomplete',
} as const satisfies Record<NonCrawlResearchStage, ResearchFailureCode>

export type ResearchEvidenceOrigin = 'planned' | 'fallback'

export interface ResearchMaterial {
  readonly evidence: AdmittedEvidence
  readonly report: ResearchReport
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly failures: readonly ResearchFailure[]
  readonly origin: ResearchEvidenceOrigin
  readonly reviewQuestions?: readonly { readonly id: string; readonly question: string }[]
}

interface FinalizeResultInput extends ResearchMaterial {
  readonly ctx: StageContext
  readonly review?: ResearchReview
}

type NonCrawlResearchStage = Exclude<ResearchFailure['stage'], 'crawl'>

interface FailedFromChildInput<T> {
  readonly ctx: StageContext
  readonly stage: NonCrawlResearchStage
  readonly result: ResearchChildResult<T>
  readonly invalidCode: ResearchFailureCode
  readonly failures?: readonly ResearchFailure[]
  readonly evidence?: AdmittedEvidence
}

interface EvidenceSummaryInput {
  readonly admittedSources: number
  readonly supportedClaims: number
  readonly issueSource: Pick<ResearchArtifact, 'gaps' | 'conflicts'>
}

interface FailedResultInput {
  readonly code: ResearchFailureCode
  readonly message: string
  readonly failures?: readonly ResearchFailure[]
  readonly evidenceSummary?: FailedResearchResult['evidenceSummary']
  readonly requiredCalls?: number
  readonly availableCalls?: number
}

export function finalizeResult(input: FinalizeResultInput): ResearchResult {
  const limit = input.ctx.config.maxArtifactBytes
  const headroom = evidenceHeadroomBytes(input.ctx, input.report)
  const evidence = boundEvidenceToArtifactLimit(input.evidence, headroom)
  const artifact = buildArtifact(input.ctx, evidence, input.report)

  if (artifactBytes(artifact) > limit) {
    return failedResult(input.ctx, {
      code: 'invalid_output',
      message: `research artifact exceeds ${limit} UTF-8 bytes`,
      failures: input.failures,
      evidenceSummary: toEvidenceSummary({
        admittedSources: input.evidence.sources.length,
        supportedClaims: input.evidence.claims.length,
        issueSource: input.evidence,
      }),
    })
  }

  const outcome = finalOutcome(input.outcome, artifact)
  return {
    status: 'complete',
    outcome,
    depth: input.ctx.depth,
    artifact,
    evidenceLevel: computeEvidenceLevel(outcome, input.origin, input.ctx.effort.reviewRoundLimit),
    failures: input.failures,
    ...(input.review === undefined ? {} : { review: input.review }),
  }
}

export function failedFromChild<T>(input: FailedFromChildInput<T>): FailedResearchResult {
  const failure = childFailure(input.stage, input.result, input.invalidCode)

  return failedResult(input.ctx, {
    code: failure.code,
    message: failure.message,
    failures: [...(input.failures ?? []), failure],
    ...(input.evidence === undefined
      ? {}
      : {
          evidenceSummary: toEvidenceSummary({
            admittedSources: input.evidence.sources.length,
            supportedClaims: input.evidence.claims.length,
            issueSource: input.evidence,
          }),
        }),
  })
}

export function childFailure<T>(
  stage: NonCrawlResearchStage,
  result: ResearchChildResult<T>,
  invalidCode: ResearchFailureCode
): ResearchFailure {
  const empty = {
    attempts: result.kind === 'halted' && result.reason === 'aborted' ? 0 : 1,
    elapsedMs: 0,
    claims: 0,
    sources: 0,
  }

  if (result.kind === 'invalid') {
    return {
      ...empty,
      code: invalidCode,
      stage,
      message: invalidResearchChildMessage(result.issues),
      ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
    }
  }

  if (result.kind === 'halted') {
    return {
      ...empty,
      code: haltedFailureCode(stage, result.reason),
      stage,
      message: result.message,
      ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
    }
  }

  if (result.kind === 'incompatible') {
    return {
      ...empty,
      code: 'model_incompatible',
      stage,
      message: result.message,
      providerModel: result.providerModel,
    }
  }

  if (result.kind === 'invalid_tool_arguments') {
    return {
      ...empty,
      code: 'invalid_tool_arguments',
      stage,
      message: result.message,
      ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
    }
  }

  return {
    ...empty,
    code: STAGE_FAILURE_CODES[stage],
    stage,
    message: `${stage} failed`,
    ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
  }
}

function failedResult(ctx: StageContext, input: FailedResultInput): FailedResearchResult {
  return {
    status: 'failed',
    depth: ctx.depth,
    code: input.code,
    message: input.message.slice(0, MAX_RESEARCH_ERROR_CHARS),
    failures: input.failures ?? [],
    ...(input.evidenceSummary === undefined ? {} : { evidenceSummary: input.evidenceSummary }),
    ...(input.requiredCalls === undefined ? {} : { requiredCalls: input.requiredCalls }),
    ...(input.availableCalls === undefined ? {} : { availableCalls: input.availableCalls }),
  }
}

export function failedFromEvidenceDisposition(
  ctx: StageContext,
  disposition: Extract<EvidenceDisposition, { readonly kind: 'failed' }>,
  failures: readonly ResearchFailure[]
): FailedResearchResult {
  const messages = [
    ...disposition.gaps.map((gap) => gap.message),
    ...disposition.conflicts.map((conflict) => conflict.message),
  ]

  return failedResult(ctx, {
    code: disposition.code,
    message: messages.join('; '),
    failures,
    evidenceSummary: toEvidenceSummary({
      admittedSources: disposition.admittedSources,
      supportedClaims: disposition.supportedClaims,
      issueSource: disposition,
    }),
  })
}

function toEvidenceSummary(
  input: EvidenceSummaryInput
): NonNullable<FailedResearchResult['evidenceSummary']> {
  return {
    admittedSources: input.admittedSources,
    supportedClaims: input.supportedClaims,
    issues: toResearchIssueSummaries(input.issueSource),
  }
}

export function cancelledResult(
  ctx: StageContext
): Extract<ResearchResult, { readonly status: 'cancelled' }> {
  return { status: 'cancelled', depth: ctx.depth }
}

interface AdmittedCrawl {
  readonly evidence: AdmittedEvidence
  readonly outcome: 'completed' | 'completed_with_gaps'
}

// The one disposition→result mapping for crawled evidence: the initial pass and the revision pass
// differ only in the phase they report, never in how a cancel or a failed admission terminates.
export async function resolveAdmittedCrawl(
  ctx: StageContext,
  input: AdmitCrawlEvidenceInput
): Promise<AdmittedCrawl | ResearchResult> {
  const disposition = await admitCrawlEvidence(ctx, input)

  if (disposition.kind === 'cancelled') {
    return cancelledResult(ctx)
  }

  if (disposition.kind === 'failed') {
    return failedFromEvidenceDisposition(ctx, disposition, input.failures)
  }

  return { evidence: disposition.evidence, outcome: disposition.outcome }
}

export function hasFailure(
  failures: readonly ResearchFailure[],
  code: ResearchFailureCode
): boolean {
  return failures.some((failure) => failure.code === code)
}

export function failedFromCrawl(
  ctx: StageContext,
  failures: readonly ResearchFailure[],
  message: string
): FailedResearchResult {
  return failedResult(ctx, {
    code: crawlFailureCode(failures),
    message: failures[0]?.message ?? message,
    failures,
  })
}

function finalOutcome(
  requested: ResearchMaterial['outcome'],
  artifact: ResearchArtifact
): ResearchMaterial['outcome'] {
  if (artifact.gaps.length > 0 || artifact.conflicts.length > 0) {
    return 'completed_with_gaps'
  }
  return requested
}

// Sufficient is a reviewed verdict: a run whose effort allows no review round tops out at mixed.
function computeEvidenceLevel(
  outcome: ResearchMaterial['outcome'],
  origin: ResearchEvidenceOrigin,
  reviewRoundLimit: number
): ResearchEvidenceLevel {
  if (outcome === 'completed') {
    return reviewRoundLimit > 0 ? 'sufficient' : 'mixed'
  }
  return origin === 'planned' ? 'mixed' : 'limited'
}

function haltedFailureCode(
  stage: NonCrawlResearchStage,
  reason: Extract<ResearchChildResult<unknown>, { readonly kind: 'halted' }>['reason']
): ResearchFailureCode {
  if (reason === 'aborted') {
    return 'aborted'
  }
  if (reason === 'budget') {
    return 'budget_exhausted'
  }
  return STAGE_FAILURE_CODES[stage]
}

function crawlFailureCode(failures: readonly ResearchFailure[]): ResearchFailureCode {
  const codes = new Set(failures.map((failure) => failure.code))
  const onlyCode = failures[0]?.code

  if (onlyCode !== undefined && codes.size === 1) {
    return onlyCode
  }

  for (const terminal of [
    'aborted',
    'budget_exhausted',
    'capacity_exhausted',
    'model_incompatible',
  ] as const) {
    if (codes.has(terminal)) {
      return terminal
    }
  }

  if (
    failures.length > 0 &&
    failures.every((failure) => PROVIDER_UNAVAILABLE_CODES.has(failure.code))
  ) {
    return 'provider_unavailable'
  }

  return 'crawler_failed'
}

/** Degrade, do not throw: a review that could not finish becomes a declared gap on the artifact. */
export function reviewIncompleteResult(
  ctx: StageContext,
  material: ResearchMaterial,
  result: Exclude<ResearchChildResult<unknown>, { readonly kind: 'value' }>
): ResearchResult {
  const failure = childFailure('review', result, 'invalid_output')

  return finalizeResult({
    ctx,
    ...material,
    evidence: addResearchGap(material.evidence, {
      code: 'review_incomplete',
      reason: failure.code,
    }),
    failures: [...material.failures, failure],
    outcome: 'completed_with_gaps',
  })
}

import type { ResearchDepth, ResolvedResearch } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'

import type {
  ResearchBudgetPool,
  ResearchChildResult,
  ResearchFailure,
  ResearchInvocation,
  ResearchPhase,
  ResearchQuota,
  ResearchRequest,
  ResearchStages,
} from '../contracts'
import type { CrawlQuestionsDeps } from '../crawl/crawl'
import type { ResearchProgress, ResearchStageDetail, ResearchStageState } from '../events'
import type { EvidenceDisposition } from '../evidence/disposition'
import type { EvidenceConflict, EvidenceGap } from '../evidence/gaps'
import type {
  AdmittedEvidence,
  ResearchArtifact,
  ResearchReport,
  ResearchRetrievalAttempt,
} from '../evidence/model'
import type {
  EvidenceGapCandidate,
  ResearchEvidenceBranch,
  ResearchQuestion,
} from '../evidence/schemas'
import type { ResearchEffortProfile, ResearchObjective } from '../planning/profile'
import { MAX_RETRIEVAL_ATTEMPTS } from '../contracts'
import { logEvidenceCoverage } from '../diagnostics'
import { admitEvidence } from '../evidence/admission'
import { buildResearchArtifact } from '../evidence/citations'
import { validateClaimCoverage } from '../evidence/coverage'
import { resolveEvidenceDisposition } from '../evidence/disposition'

const ENCODER = new TextEncoder()
const EMPTY_EVIDENCE: AdmittedEvidence = {
  sources: [],
  excerpts: [],
  claims: [],
  numericLinks: [],
  gaps: [],
  conflicts: [],
}
const PROVIDER_FAILURE_CODES: ReadonlySet<ResearchFailure['code']> = new Set([
  'provider_unavailable',
  'llm_provider_failed',
  'source_unavailable',
])

export interface StageContext {
  readonly logger: Logger
  readonly depth: ResearchDepth
  readonly request: ResearchRequest
  readonly invocation: ResearchInvocation
  readonly stages: ResearchStages
  readonly quota: ResearchQuota
  readonly budgets: ResearchBudgetPool
  readonly config: ResolvedResearch
  readonly objective: ResearchObjective
  readonly effort: ResearchEffortProfile
  readonly now: number
  readonly maxQuestions: number
  readonly maxBudgetedQuestions: number
  readonly maxParallelDelegations: number
  readonly retrievalAttempts: ResearchRetrievalAttempt[]
}

export interface AdmitCrawlEvidenceInput {
  readonly branches: readonly ResearchEvidenceBranch[]
  readonly failures: readonly ResearchFailure[]
  readonly phase?: 'initial' | 'revision'
}

export async function admitCrawlEvidence(
  ctx: StageContext,
  input: AdmitCrawlEvidenceInput
): Promise<EvidenceDisposition | { readonly kind: 'cancelled' }> {
  if (ctx.invocation.signal.aborted) {
    return { kind: 'cancelled' }
  }

  const admission = await admitEvidence({
    candidates: [...input.branches, ...failureGapBranches(input.failures)],
    bounds: {
      maxExcerptChars: ctx.config.maxExcerptChars,
      maxExcerptsPerSource: ctx.config.maxExcerptsPerSource,
      maxArtifactBytes: ctx.config.maxArtifactBytes,
    },
    now: ctx.now,
    signal: ctx.invocation.signal,
    ...(ctx.request.freshness === undefined ? {} : { freshness: ctx.request.freshness }),
  })

  if (admission.kind === 'cancelled' || ctx.invocation.signal.aborted) {
    return { kind: 'cancelled' }
  }

  if (admission.kind === 'failed') {
    return insufficientEvidenceDisposition({
      admittedSources: admission.sources.length,
      supportedClaims: 0,
      gaps: admission.gaps,
    })
  }

  const coverage = validateClaimCoverage(admission.evidence)
  logEvidenceCoverage(ctx.logger, {
    phase: input.phase ?? 'initial',
    evidence: admission.evidence,
    coverage,
  })

  return resolveEvidenceDisposition(
    admission.evidence,
    coverage,
    evidenceHeadroomBytes(ctx, maxReportShape(admission.evidence))
  )
}

function insufficientEvidenceDisposition(input: {
  readonly admittedSources: number
  readonly supportedClaims: number
  readonly gaps: readonly EvidenceGap[]
  readonly conflicts?: readonly EvidenceConflict[]
}): Extract<EvidenceDisposition, { readonly kind: 'failed' }> {
  return {
    kind: 'failed',
    code: 'insufficient_evidence',
    admittedSources: input.admittedSources,
    supportedClaims: input.supportedClaims,
    gaps: input.gaps,
    conflicts: input.conflicts ?? [],
  }
}

export function crawlDeps(ctx: StageContext): CrawlQuestionsDeps {
  return {
    stages: ctx.stages,
    quota: ctx.quota,
    budgets: ctx.budgets,
    signal: ctx.invocation.signal,
    maxParallelDelegations: ctx.maxParallelDelegations,
    reportStage: (state) => reportResearchStage(ctx, { stage: 'crawl', state }),
    ...(ctx.invocation.reportProgress === undefined
      ? {}
      : { reportProgress: ctx.invocation.reportProgress }),
  }
}

function reportResearchProgress(ctx: StageContext, message: ResearchProgress): void {
  if (!ctx.invocation.signal.aborted) {
    ctx.invocation.reportProgress?.(message)
  }
}

interface ResearchStageProgressInput {
  readonly stage: ResearchPhase
  readonly state: ResearchStageState
  readonly detail?: ResearchStageDetail
}

interface ResearchStageWorkInput<T> {
  readonly stage: ResearchPhase
  readonly detail?: ResearchStageDetail
  readonly run: () => Promise<T>
}

export function reportResearchStage(ctx: StageContext, input: ResearchStageProgressInput): void {
  reportResearchProgress(ctx, {
    key: 'progress.researchStage',
    params: {
      stage: input.stage,
      state: input.state,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
    },
  })
}

export async function runResearchStageWork<T>(
  ctx: StageContext,
  input: ResearchStageWorkInput<T>
): Promise<T> {
  reportResearchStage(ctx, {
    stage: input.stage,
    state: 'running',
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  })

  try {
    return await input.run()
  } catch (err: unknown) {
    try {
      reportResearchStage(ctx, { stage: input.stage, state: 'failed' })
    } catch {
      // Progress is observational and must not mask the original stage failure.
    }
    throw err
  }
}

// A stage transition settles with exactly one terminal event: success, or failure for any stop
// except abort, which only removes the transient surface state.
export function reportResearchStageSettlement<T>(
  ctx: StageContext,
  stage: 'synthesize' | 'review',
  result: ResearchChildResult<T>
): void {
  if (result.kind === 'value') {
    reportResearchStage(ctx, { stage, state: 'complete' })
    return
  }
  if (result.kind !== 'halted' || result.reason !== 'aborted') {
    reportResearchStage(ctx, { stage, state: 'failed' })
  }
}

export function reportResearchPlanCard(ctx: StageContext, questions: readonly string[]): void {
  reportResearchProgress(ctx, {
    key: 'progress.researchPlan',
    mode: 'persistent',
    params: { questions },
  })
}

export function reportResearchQuestionsRunning(
  ctx: StageContext,
  questions: readonly ResearchQuestion[]
): void {
  for (const [index, question] of questions.entries()) {
    reportResearchQuestionRunning(ctx, question, { index: index + 1, total: questions.length })
  }
}

export function reportResearchQuestionRunning(
  ctx: StageContext,
  question: ResearchQuestion,
  position: { readonly index: number; readonly total: number; readonly fallback?: true }
): void {
  reportResearchProgress(ctx, {
    key: 'progress.researchQuestion',
    params: {
      questionId: question.id,
      question: question.question,
      index: position.index,
      total: position.total,
      state: 'running',
      ...(position.fallback === undefined ? {} : { fallback: position.fallback }),
    },
  })
}

function failureGapBranches(
  failures: readonly ResearchFailure[]
): readonly ResearchEvidenceBranch[] {
  return failures.map((failure, index) => ({
    questionId: failure.questionId ?? `failed-${index + 1}`,
    sources: [],
    excerpts: [],
    claims: [],
    numericLinks: [],
    gaps: [failureGap(failure)],
  }))
}

function failureGap(failure: ResearchFailure): EvidenceGapCandidate {
  const stem = {
    claimRefs: [],
    excerptRefs: [],
    sourceRefs: [],
    values: [failure.code, ...(failure.questionId === undefined ? [] : [failure.questionId])],
    message: failure.message,
  }

  if (PROVIDER_FAILURE_CODES.has(failure.code)) {
    return { code: 'provider_unavailable', ...stem }
  }

  return { code: 'validation', params: { reason: 'question_failed' }, ...stem }
}

export function buildArtifact(
  ctx: StageContext,
  evidence: AdmittedEvidence,
  report: ResearchReport
): ResearchArtifact {
  return {
    ...buildResearchArtifact(evidence, report),
    retrievalAttempts: ctx.retrievalAttempts.slice(0, MAX_RETRIEVAL_ATTEMPTS),
  }
}

export function artifactBytes(artifact: ResearchArtifact): number {
  return ENCODER.encode(JSON.stringify(artifact)).byteLength
}

/**
 * Bytes the evidence may occupy inside the artifact. The artifact also carries the report and the
 * retrieval attempts, so bounding evidence to the whole cap leaves the assembled artifact over it,
 * discarding a finished report. Measuring the envelope with no evidence in it yields what is left.
 */
export function evidenceHeadroomBytes(ctx: StageContext, report: ResearchReport): number {
  return ctx.config.maxArtifactBytes - artifactBytes(buildArtifact(ctx, EMPTY_EVIDENCE, report))
}

/**
 * The costliest report this evidence could produce, for reserving headroom before synthesis has
 * written one. A report cites a subset of these claim ids, and byte size is section-independent.
 */
export function maxReportShape(evidence: AdmittedEvidence): ResearchReport {
  return {
    answer: evidence.claims.map((claim) => claim.id),
    keyEvidence: [],
    risks: [],
    conflicts: [],
    practicalConsiderations: [],
  }
}

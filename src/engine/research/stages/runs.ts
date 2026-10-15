import type { Logger } from '@/core/logging/logger'
import type { BudgetSlice } from '@/engine/types/cost'

import type {
  ResearchBudgetPool,
  ResearchChildResult,
  ResearchFailure,
  ResearchQuota,
  ResearchReview,
} from '../contracts'
import type { ResearchStageDetail } from '../events'
import type { AdmittedEvidence, ResearchReport } from '../evidence/model'
import type { ResearchReportCandidate } from '../evidence/schemas'
import type { ResearchMaterial } from '../results'
import { logReviewVerdict } from '../diagnostics'
import { resolveResearchReport } from '../evidence/citations'
import { researchEvidenceBytes } from '../evidence/disposition'
import { MAX_LOGGED_ISSUE_PATHS, toSanitizedIssuePaths } from './children'
import {
  buildArtifact,
  reportResearchStageSettlement,
  runResearchStageWork,
  type StageContext,
} from './funnel'

interface SettledStageInput<T> {
  readonly ctx: StageContext
  readonly stage: 'synthesize' | 'review'
  readonly knownFutureCalls: number
  readonly detail?: ResearchStageDetail
  readonly validate?: (value: T) => StageValidation
  readonly attempt: ValidatedStageInput<T>['attempt']
}

type ValidatedStagePhase = 'plan' | 'synthesize' | 'review'

interface StageRefusal {
  readonly logger: Logger
  readonly phase: ValidatedStagePhase
  readonly result: ResearchChildResult<unknown>
  readonly issues: readonly string[]
}

interface KnownReviewReferences {
  readonly claimIds: ReadonlySet<string>
  readonly questionIds: ReadonlySet<string>
  readonly answerClaimIds: ReadonlySet<string>
}

// Both arms earn one correction round; only a blocking issue survives it as a refusal.
interface StageValidation {
  readonly blocking: readonly string[]
  readonly advisory: readonly string[]
}

interface SynthesizeReportInput {
  readonly ctx: StageContext
  readonly evidence: AdmittedEvidence
  readonly failures: readonly ResearchFailure[]
  readonly knownFutureCalls: number
  readonly correctionIssues?: readonly string[]
}
export async function synthesizeReport(
  input: SynthesizeReportInput
): Promise<ResearchChildResult<ResearchReport>> {
  if (input.ctx.invocation.signal.aborted) {
    return { kind: 'halted', reason: 'aborted', message: 'research aborted' }
  }

  const evidenceBytes = researchEvidenceBytes(input.evidence)
  const evidenceLimit = input.ctx.config.maxArtifactBytes

  if (evidenceBytes > evidenceLimit) {
    return {
      kind: 'invalid',
      issues: [`admitted evidence exceeds ${evidenceLimit} UTF-8 byte synthesis headroom`],
    }
  }

  return runSettledStage({
    ctx: input.ctx,
    stage: 'synthesize',
    knownFutureCalls: input.knownFutureCalls,
    detail: {
      key: 'progress.researchSupportedClaims',
      params: { sources: input.evidence.sources.length, claims: input.evidence.claims.length },
    },
    attempt: async (budget, parseIssues) => {
      const result = await input.ctx.stages.synthesize(
        {
          query: input.ctx.request.query,
          locale: input.ctx.invocation.locale,
          evidence: input.evidence,
          ...(input.correctionIssues === undefined
            ? {}
            : { correctionIssues: input.correctionIssues }),
        },
        budget,
        parseIssues
      )
      return resolveSynthesisResult(result, input.evidence)
    },
  })
}

export async function reviewReport(
  ctx: StageContext,
  material: ResearchMaterial,
  knownFutureCalls: number
): Promise<ResearchChildResult<ResearchReview>> {
  const artifact = buildArtifact(ctx, material.evidence, material.report)
  const questions = material.reviewQuestions ?? []
  const known: KnownReviewReferences = {
    claimIds: new Set<string>(artifact.claims.map((claim) => claim.id)),
    questionIds: new Set<string>(questions.map((question) => question.id)),
    answerClaimIds: new Set<string>(
      artifact.claims.filter((claim) => claim.section === 'answer').map((claim) => claim.id)
    ),
  }

  const result = await runSettledStage<ResearchReview>({
    ctx,
    stage: 'review',
    knownFutureCalls,
    validate: (review) => validateReview(review, known),
    attempt: (budget, correctionIssues) =>
      ctx.stages.review(
        {
          query: ctx.request.query,
          locale: ctx.invocation.locale,
          artifact,
          questions,
        },
        budget,
        correctionIssues
      ),
  })

  if (result.kind === 'value') {
    logReviewVerdict(ctx.logger, { review: result.value, claims: artifact.claims })
  }
  return result
}

// Question ids are validated alongside claim ids because a follow-up naming an unknown question is
// discarded downstream with only a warning: the reviewer never learns its research was dropped.
// A verdict naming ids the artifact does not hold cannot be applied at all. One that deletes an
// answer claim without asking for replacement evidence is still a usable judgment about entailment.
function validateReview(review: ResearchReview, known: KnownReviewReferences): StageValidation {
  return {
    blocking: [
      ...unknownReferences(
        [
          ...review.unsupportedClaimIds,
          ...review.unverifiedClaimIds,
          ...review.issues.flatMap((issue) => issue.claimIds),
        ],
        known.claimIds,
        'claim id'
      ),
      ...unknownReferences(
        review.issues.flatMap((issue) => issue.questionIds),
        known.questionIds,
        'question id'
      ),
    ],
    advisory: unrepairedAnswerDeletions(review, known.answerClaimIds),
  }
}

function unknownReferences(
  referenced: readonly string[],
  known: ReadonlySet<string>,
  label: string
): readonly string[] {
  return [...new Set(referenced.filter((id) => !known.has(id)))].map(
    (id) => `review referenced an unknown ${label}: ${id}`
  )
}

// Nothing replaces a deleted answer claim unless an issue asks for the evidence, so refuse the
// verdict once. A reviewer that still deletes without repairing keeps its revision, gaps and all.
function unrepairedAnswerDeletions(
  review: ResearchReview,
  answerClaimIds: ReadonlySet<string>
): readonly string[] {
  const repaired = new Set(
    review.issues.filter((issue) => issue.requiresResearch).flatMap((issue) => issue.claimIds)
  )

  return review.unsupportedClaimIds
    .filter((claimId) => answerClaimIds.has(claimId) && !repaired.has(claimId))
    .map(
      (claimId) =>
        `review deleted answer claim ${claimId} without repairing it: set requiresResearch and followUpQuery on the issue naming it, or leave the claim supported`
    )
}

async function runSettledStage<T>(input: SettledStageInput<T>): Promise<ResearchChildResult<T>> {
  const result = await runResearchStageWork(input.ctx, {
    stage: input.stage,
    ...(input.detail === undefined ? {} : { detail: input.detail }),
    run: () =>
      runValidatedStage({
        signal: input.ctx.invocation.signal,
        quota: input.ctx.quota,
        budgets: input.ctx.budgets,
        phase: input.stage,
        knownFutureCalls: input.knownFutureCalls,
        logger: input.ctx.logger,
        ...(input.validate === undefined ? {} : { validate: input.validate }),
        attempt: input.attempt,
      }),
  })
  reportResearchStageSettlement(input.ctx, input.stage, result)
  return result
}

interface ValidatedStageInput<T> {
  readonly signal: AbortSignal
  readonly quota: ResearchQuota
  readonly budgets: ResearchBudgetPool
  readonly phase: ValidatedStagePhase
  readonly knownFutureCalls: number
  readonly logger: Logger
  readonly validate?: (value: T) => StageValidation
  readonly attempt: (
    budget: BudgetSlice,
    correctionIssues?: readonly string[]
  ) => Promise<ResearchChildResult<T>>
}

async function runValidatedStage<T>(
  input: ValidatedStageInput<T>
): Promise<ResearchChildResult<T>> {
  const first = await runValidatedAttempt(input)
  const firstIssues = allStageIssues(stageValidation(first, input.validate))

  if (firstIssues.length === 0) {
    return first
  }

  logStageRefusal({ logger: input.logger, phase: input.phase, result: first, issues: firstIssues })

  if (input.signal.aborted) {
    return abortedResult()
  }

  // An unfunded correction is skipped: the first result is judged as the correction would be.
  const funded = input.quota.reserveUpTo(1) === 1
  const corrected = funded ? await runValidatedAttempt(input, firstIssues) : first
  const validation = stageValidation(corrected, input.validate)
  const correctedIssues = allStageIssues(validation)

  if (corrected.kind === 'value' && correctedIssues.length > 0) {
    if (funded) {
      logStageRefusal({
        logger: input.logger,
        phase: input.phase,
        result: corrected,
        issues: correctedIssues,
      })
    }

    // An advisory issue buys one refusal, not a discard: the restated value still carries a verdict.
    if (validation.blocking.length === 0) {
      return corrected
    }

    return {
      kind: 'invalid',
      issues: validation.blocking,
      ...(corrected.providerModel === undefined ? {} : { providerModel: corrected.providerModel }),
    }
  }

  return corrected
}

async function runValidatedAttempt<T>(
  input: ValidatedStageInput<T>,
  correctionIssues?: readonly string[]
): Promise<ResearchChildResult<T>> {
  if (input.signal.aborted) {
    return abortedResult()
  }

  const slices = input.budgets.take(input.phase, 1, input.knownFutureCalls)
  const slice = slices[0]
  if (slice === undefined) {
    return budgetResult(input.phase)
  }

  try {
    return await input.attempt(slice, correctionIssues)
  } finally {
    slice.settle()
  }
}

function stageValidation<T>(
  result: ResearchChildResult<T>,
  validate: ((value: T) => StageValidation) | undefined
): StageValidation {
  if (result.kind === 'invalid') {
    return { blocking: result.issues, advisory: [] }
  }

  return result.kind === 'value' && validate !== undefined
    ? validate(result.value)
    : { blocking: [], advisory: [] }
}

function allStageIssues(validation: StageValidation): readonly string[] {
  return [...validation.blocking, ...validation.advisory]
}

// Without this a correction round reads as a schema failure even when a policy refused it.
// Parser issues carry model prose after the schema path, so only paths log; policy issues are
// code-owned templates and log whole. Both lists are bounded.
function logStageRefusal(refusal: StageRefusal): void {
  const refusedBy = refusal.result.kind === 'invalid' ? 'schema' : 'policy'

  refusal.logger.debug('research.stage_refused', {
    phase: refusal.phase,
    refusedBy,
    issueCount: refusal.issues.length,
    issues:
      refusedBy === 'schema'
        ? toSanitizedIssuePaths(refusal.issues)
        : refusal.issues.slice(0, MAX_LOGGED_ISSUE_PATHS),
  })
}

export function abortedResult<T>(): ResearchChildResult<T> {
  return { kind: 'halted', reason: 'aborted', message: 'research aborted' }
}

function budgetResult<T>(phase: string): ResearchChildResult<T> {
  return { kind: 'halted', reason: 'budget', message: `insufficient budget for ${phase}` }
}

function resolveSynthesisResult(
  result: ResearchChildResult<ResearchReportCandidate>,
  evidence: AdmittedEvidence
): ResearchChildResult<ResearchReport> {
  if (result.kind !== 'value') {
    return result
  }

  const resolved = resolveResearchReport(result.value, evidence)
  if (resolved.kind === 'invalid') {
    return {
      kind: 'invalid',
      issues: resolved.issues,
      ...(result.providerModel === undefined ? {} : { providerModel: result.providerModel }),
    }
  }

  return { ...result, value: resolved.report }
}

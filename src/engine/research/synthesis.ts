import type {
  FailedResearchResult,
  ResearchChildResult,
  ResearchFailure,
  ResearchResult,
} from './contracts'
import type { AdmittedEvidence, ClaimId, ResearchReport } from './evidence/model'
import type { ResearchEvidenceOrigin } from './results'
import type { StageContext } from './stages/funnel'
import {
  MAX_CONFLICTS,
  MAX_KEY_EVIDENCE,
  MAX_PRACTICAL_CONSIDERATIONS,
  MAX_RISKS,
} from './contracts'
import { addResearchGap } from './evidence/gaps'
import { cancelledResult, childFailure, failedFromChild, finalizeResult } from './results'
import { synthesizeReport } from './stages/runs'

interface SynthesizeOrRecoverInput {
  readonly ctx: StageContext
  readonly evidence: AdmittedEvidence
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly failures: readonly ResearchFailure[]
  readonly origin: ResearchEvidenceOrigin
  readonly knownFutureCalls: number
  readonly correctionIssues?: readonly string[]
}

/**
 * Synthesis with its recovery attached: a non-value result never reaches a caller, it becomes
 * either a deterministic section-pick report or a typed failure.
 */
export async function synthesizeOrRecover(
  input: SynthesizeOrRecoverInput
): Promise<ResearchReport | ResearchResult> {
  const synthesis = await synthesizeReport({
    ctx: input.ctx,
    evidence: input.evidence,
    failures: input.failures,
    knownFutureCalls: input.knownFutureCalls,
    ...(input.correctionIssues === undefined ? {} : { correctionIssues: input.correctionIssues }),
  })

  if (synthesis.kind === 'value') {
    return synthesis.value
  }

  return recoverInitialSynthesis({ ...input, result: synthesis })
}

interface RecoverInitialSynthesisInput {
  readonly ctx: StageContext
  readonly evidence: AdmittedEvidence
  readonly outcome: 'completed' | 'completed_with_gaps'
  readonly failures: readonly ResearchFailure[]
  readonly origin: ResearchEvidenceOrigin
  readonly result: Exclude<ResearchChildResult<ResearchReport>, { readonly kind: 'value' }>
}

function recoverInitialSynthesis(input: RecoverInitialSynthesisInput): ResearchResult {
  if (input.result.kind === 'halted' && input.result.reason === 'aborted') {
    return cancelledResult(input.ctx)
  }

  if (input.result.kind !== 'invalid') {
    return toFailedSynthesis(input)
  }

  const report = toEvidenceReport(input.evidence)
  if (report === undefined) {
    return toFailedSynthesis(input)
  }

  const failure = childFailure('synthesize', input.result, 'synthesizer_failed')
  const failures = [...input.failures, failure]
  const evidence = addResearchGap(input.evidence, {
    code: 'synthesis_recovery',
    reason: failure.code,
  })

  return finalizeResult({
    ctx: input.ctx,
    evidence,
    report,
    outcome: 'completed_with_gaps',
    failures,
    origin: input.origin,
  })
}

function toFailedSynthesis(input: RecoverInitialSynthesisInput): FailedResearchResult {
  return failedFromChild({
    ctx: input.ctx,
    stage: 'synthesize',
    result: input.result,
    invalidCode: 'synthesizer_failed',
    failures: input.failures,
    evidence: input.evidence,
  })
}

function toEvidenceReport(evidence: AdmittedEvidence): ResearchReport | undefined {
  const answer = claimIdsForSection(evidence, 'answer', 1)
  if (answer.length === 0) {
    return undefined
  }

  return {
    answer,
    keyEvidence: claimIdsForSection(evidence, 'keyEvidence', MAX_KEY_EVIDENCE),
    risks: claimIdsForSection(evidence, 'risks', MAX_RISKS),
    conflicts: claimIdsForSection(evidence, 'conflicts', MAX_CONFLICTS),
    practicalConsiderations: claimIdsForSection(
      evidence,
      'practicalConsiderations',
      MAX_PRACTICAL_CONSIDERATIONS
    ),
  }
}

function claimIdsForSection(
  evidence: AdmittedEvidence,
  section: AdmittedEvidence['claims'][number]['section'],
  limit: number
): readonly ClaimId[] {
  return evidence.claims
    .filter((claim) => claim.section === section)
    .slice(0, limit)
    .map((claim) => claim.id)
}

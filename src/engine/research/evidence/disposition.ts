import type { CoverageResult } from './coverage'
import type { EvidenceConflict, EvidenceGap } from './gaps'
import type { AdmittedEvidence, ClaimId, EvidenceExcerptId, ResearchClaim, SourceId } from './model'
import { independentSupportCounts } from './corroboration'
import { createGap } from './gaps'
import { hasAnswerClaim } from './model'

const ENCODER = new TextEncoder()

export type EvidenceDisposition =
  | {
      readonly kind: 'failed'
      readonly code: 'insufficient_evidence'
      readonly admittedSources: number
      readonly supportedClaims: number
      readonly gaps: readonly EvidenceGap[]
      readonly conflicts: readonly EvidenceConflict[]
    }
  | {
      readonly kind: 'usable'
      readonly outcome: 'completed' | 'completed_with_gaps'
      readonly evidence: AdmittedEvidence
    }

type EvidenceHeadroomResult =
  | {
      readonly kind: 'bounded'
      readonly evidence: AdmittedEvidence
      readonly truncated: boolean
    }
  | { readonly kind: 'insufficient'; readonly gap: EvidenceGap }

interface EvidenceSelection {
  readonly evidence: AdmittedEvidence
  readonly claims: readonly ResearchClaim[]
  readonly gaps: readonly EvidenceGap[]
  readonly conflicts: readonly EvidenceConflict[]
}

interface EvidenceReferences {
  readonly claimIds: ReadonlySet<ClaimId>
  readonly excerptIds: ReadonlySet<EvidenceExcerptId>
  readonly sourceIds: ReadonlySet<SourceId>
}

/** Returns the exact UTF-8 size of the serialized evidence envelope sent to synthesis. */
export function researchEvidenceBytes(evidence: AdmittedEvidence): number {
  return ENCODER.encode(JSON.stringify(evidence)).byteLength
}

/**
 * Converts admitted evidence and coverage into the only state allowed to enter synthesis, bounded
 * to the synthesizer's byte headroom. Bounding runs here and nowhere else, deliberately after
 * coverage so the gaps coverage declares are inside the bound.
 */
export function resolveEvidenceDisposition(
  evidence: AdmittedEvidence,
  coverage: CoverageResult,
  maxArtifactBytes: number
): EvidenceDisposition {
  if (evidence.excerpts.length === 0) {
    return toInsufficientEvidence(evidence, coverage, 'no usable evidence excerpt was admitted')
  }

  const retainedClaims = coverage.claims

  if (retainedClaims.length === 0) {
    return toInsufficientEvidence(evidence, coverage, 'no supported evidence claim was admitted')
  }

  // Supporting evidence with no direct answer is a thinner report, not a failed run: refusing here
  // throws away sources the operator can still act on, so the shortfall is declared instead.
  const gaps = hasAnswerClaim(retainedClaims)
    ? coverage.gaps
    : [
        ...coverage.gaps,
        createGap({
          code: 'answer_claim_absent',
          message: 'no supported answer claim was admitted',
        }),
      ]

  const covered: AdmittedEvidence = {
    sources: evidence.sources,
    excerpts: evidence.excerpts,
    claims: retainedClaims,
    numericLinks: coverage.numericLinks,
    gaps,
    conflicts: coverage.conflicts,
  }
  const hasMaterialGap = gaps.length > 0 || coverage.conflicts.length > 0

  return toBoundedDisposition(
    covered,
    hasMaterialGap ? 'completed_with_gaps' : 'completed',
    maxArtifactBytes
  )
}

/**
 * Re-applies the byte bound after finalization-time gap appends (recovery notes, review warnings),
 * within the share of the artifact cap the report and the retrieval attempts leave free.
 */
export function boundEvidenceToArtifactLimit(
  evidence: AdmittedEvidence,
  maxEvidenceBytes: number
): AdmittedEvidence {
  const bounded = boundEvidenceToHeadroom(evidence, maxEvidenceBytes)
  if (bounded.kind === 'insufficient') {
    return selectEvidence({ evidence, claims: [], gaps: [bounded.gap], conflicts: [] })
  }
  return bounded.evidence
}

function toBoundedDisposition(
  covered: AdmittedEvidence,
  outcome: 'completed' | 'completed_with_gaps',
  maxArtifactBytes: number
): EvidenceDisposition {
  const bounded = boundEvidenceToHeadroom(covered, maxArtifactBytes)

  if (bounded.kind === 'insufficient' || bounded.evidence.excerpts.length === 0) {
    return {
      kind: 'failed',
      code: 'insufficient_evidence',
      admittedSources: covered.sources.length,
      supportedClaims: covered.claims.length,
      gaps: [bounded.kind === 'insufficient' ? bounded.gap : headroomGap()],
      conflicts: [],
    }
  }

  return {
    kind: 'usable',
    outcome: bounded.truncated ? 'completed_with_gaps' : outcome,
    evidence: bounded.evidence,
  }
}

function toInsufficientEvidence(
  evidence: AdmittedEvidence,
  coverage: CoverageResult,
  message: string
): Extract<EvidenceDisposition, { readonly kind: 'failed' }> {
  const gaps =
    coverage.gaps.length > 0 ? coverage.gaps : [createGap({ code: 'missing_support', message })]

  return {
    kind: 'failed',
    code: 'insufficient_evidence',
    admittedSources: evidence.sources.length,
    supportedClaims: coverage.claims.length,
    gaps,
    conflicts: coverage.conflicts,
  }
}

function headroomGap(): EvidenceGap {
  return createGap({
    code: 'artifact_limit',
    message: 'evidence truncated to synthesizer headroom',
  })
}

/**
 * Deterministically keeps complete claim support units until the exact serialized envelope reaches
 * the synthesis cap. Every surviving reference resolves inside the returned evidence.
 */
function boundEvidenceToHeadroom(
  evidence: AdmittedEvidence,
  maxBytes: number
): EvidenceHeadroomResult {
  const limit = Math.max(1, Math.floor(maxBytes))
  const gap = headroomGap()

  if (researchEvidenceBytes(evidence) <= limit) {
    return { kind: 'bounded', evidence, truncated: false }
  }

  let bounded = selectEvidence({ evidence, claims: [], gaps: [gap], conflicts: [] })
  if (researchEvidenceBytes(bounded) > limit) {
    return { kind: 'insufficient', gap }
  }

  const byPriority = [...evidence.claims].sort(prioritySort(evidence))
  const admittedIds = new Set<ClaimId>()
  let claims: readonly ResearchClaim[] = []
  for (const claim of byPriority) {
    if (claim.evidenceIds.length === 0) {
      continue
    }

    const candidateClaims = evidence.claims.filter(
      (each) => admittedIds.has(each.id) || each.id === claim.id
    )
    const candidate = selectEvidence({
      evidence,
      claims: candidateClaims,
      gaps: [gap],
      conflicts: [],
    })
    if (researchEvidenceBytes(candidate) <= limit) {
      admittedIds.add(claim.id)
      claims = candidateClaims
      bounded = candidate
    }
  }

  const gaps: EvidenceGap[] = [gap]
  for (const extra of evidence.gaps) {
    const candidate = selectEvidence({ evidence, claims, gaps: [...gaps, extra], conflicts: [] })

    if (researchEvidenceBytes(candidate) <= limit) {
      gaps.push(extra)
      bounded = candidate
    }
  }

  const conflicts: EvidenceConflict[] = []
  const retainedClaimIds = new Set(claims.map((claim) => claim.id))
  for (const conflict of evidence.conflicts) {
    if (!conflict.claimIds.every((id) => retainedClaimIds.has(id))) {
      continue
    }

    const candidate = selectEvidence({
      evidence,
      claims,
      gaps,
      conflicts: [...conflicts, conflict],
    })
    if (researchEvidenceBytes(candidate) <= limit) {
      conflicts.push(conflict)
      bounded = candidate
    }
  }

  return { kind: 'bounded', evidence: bounded, truncated: true }
}

// Lower is admitted first: the answer section outranks the rest, a grounded figure outranks prose.
function claimPriority(claim: ResearchClaim): number {
  return (claim.section === 'answer' ? 0 : 2) + (claim.kind === 'numeric' ? 0 : 1)
}

// Priority first; ties admit the better-corroborated claim, then keep arrival order.
function prioritySort(evidence: AdmittedEvidence) {
  const support = independentSupportCounts(evidence)
  return (a: ResearchClaim, b: ResearchClaim): number =>
    claimPriority(a) - claimPriority(b) || (support.get(b.id) ?? 0) - (support.get(a.id) ?? 0)
}

function selectEvidence(input: EvidenceSelection): AdmittedEvidence {
  const claimIds = new Set<ClaimId>(input.claims.map((claim) => claim.id))
  const excerptIds = new Set<EvidenceExcerptId>(input.claims.flatMap((claim) => claim.evidenceIds))
  const excerpts = input.evidence.excerpts.filter((excerpt) => excerptIds.has(excerpt.id))
  const sourceIds = new Set<SourceId>(excerpts.map((excerpt) => excerpt.sourceId))
  const references = { claimIds, excerptIds, sourceIds }

  return {
    sources: input.evidence.sources.filter((source) => sourceIds.has(source.id)),
    excerpts,
    claims: input.claims,
    numericLinks: input.evidence.numericLinks.filter(
      (link) => claimIds.has(link.claimId) && excerptIds.has(link.excerptId)
    ),
    gaps: input.gaps.map((gap) => filterGapReferences(gap, references)),
    conflicts: input.conflicts
      .filter((conflict) => conflict.claimIds.every((id) => claimIds.has(id)))
      .map((conflict) => filterConflictReferences(conflict, excerptIds)),
  }
}

function filterGapReferences(gap: EvidenceGap, references: EvidenceReferences): EvidenceGap {
  return {
    ...gap,
    claimIds: gap.claimIds.filter((id) => references.claimIds.has(id)),
    excerptIds: gap.excerptIds.filter((id) => references.excerptIds.has(id)),
    sourceIds: gap.sourceIds.filter((id) => references.sourceIds.has(id)),
  }
}

function filterConflictReferences(
  conflict: EvidenceConflict,
  excerptIds: ReadonlySet<EvidenceExcerptId>
): EvidenceConflict {
  return { ...conflict, excerptIds: conflict.excerptIds.filter((id) => excerptIds.has(id)) }
}

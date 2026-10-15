import type { CreateGapInput, EvidenceGap } from './gaps'
import type {
  ClaimId,
  DateConfidence,
  DateProvenance,
  EvidenceExcerpt,
  EvidenceExcerptId,
  NumericEvidenceLink,
  ResearchClaim,
  ResearchFreshness,
  ResearchSource,
  SourceId,
} from './model'
import type {
  EvidenceGapCandidate,
  NumericEvidenceLinkCandidate,
  ResearchClaimCandidate,
  ResearchEvidenceBranch,
  ResearchSourceCandidate,
} from './schemas'
import { MAX_CLAIM_CHARS } from '../contracts'
import { canonicalizeResearchUrl } from './citations'
import { createGap } from './gaps'
import { ClaimIdSchema } from './model'
import {
  classifySafety,
  freshnessDisposition,
  truncateForGap,
  truncateOnCodePoint,
} from './normalize'

// Resolution maps shared with the admission state. The state class owns the maps; these free
// functions resolve branch-local candidate refs to canonical artifact IDs (or emit named gaps for
// unresolved/duplicate refs) without holding any state of their own.

export interface ResolutionState {
  pushGap(input: CreateGapInput): void
  readonly claims: ResearchClaim[]
  readonly numericLinks: NumericEvidenceLink[]
  readonly excerptIdByRef: ReadonlyMap<string, EvidenceExcerptId>
  readonly claimIdByRef: Map<string, ClaimId>
  readonly sourceIdByUrl: ReadonlyMap<string, SourceId>
  claimCounter: number
}

interface BuildResearchSourceInput {
  readonly candidate: ResearchSourceCandidate
  readonly canonicalUrl: string
  readonly id: SourceId
  readonly now: number
}

interface ApplySourceFreshnessInput {
  readonly sources: readonly ResearchSource[]
  readonly excerpts: readonly EvidenceExcerpt[]
  readonly claims: readonly ResearchClaim[]
  readonly numericLinks: readonly NumericEvidenceLink[]
  readonly freshness: ResearchFreshness
}

interface FreshEvidenceSet {
  readonly sources: readonly ResearchSource[]
  readonly excerpts: readonly EvidenceExcerpt[]
  readonly claims: readonly ResearchClaim[]
  readonly numericLinks: readonly NumericEvidenceLink[]
  readonly gaps: readonly EvidenceGap[]
}

interface ResolvedDateFields {
  readonly publishedOn?: string
  readonly updatedOn?: string
  readonly dateProvenance?: DateProvenance
  readonly dateConfidence?: DateConfidence
}

export function resolveClaims(
  state: ResolutionState,
  branches: readonly ResearchEvidenceBranch[]
): void {
  for (const [index, branch] of branches.entries()) {
    const scope = candidateBranchScope(branch.questionId, index)
    for (const candidate of branch.claims) {
      resolveClaim(state, scope, candidate)
    }
  }
}

export function resolveNumericLinks(
  state: ResolutionState,
  branches: readonly ResearchEvidenceBranch[]
): void {
  for (const [index, branch] of branches.entries()) {
    const scope = candidateBranchScope(branch.questionId, index)
    for (const candidate of branch.numericLinks) {
      resolveNumericLink(state, scope, candidate)
    }
  }
}

export function resolveGaps(
  state: ResolutionState,
  branches: readonly ResearchEvidenceBranch[]
): void {
  for (const [index, branch] of branches.entries()) {
    const scope = candidateBranchScope(branch.questionId, index)
    for (const candidate of branch.gaps) {
      resolveGap(state, scope, candidate)
    }
  }
}

export function candidateBranchScope(questionId: string, index: number): string {
  return `${index}\u0000${questionId}`
}

export function candidateReferenceKey(scope: string, ref: string): string {
  return `${scope}\u0000${ref}`
}

function resolveClaim(
  state: ResolutionState,
  scope: string,
  candidate: ResearchClaimCandidate
): void {
  const referenceKey = candidateReferenceKey(scope, candidate.ref)
  if (state.claimIdByRef.has(referenceKey)) {
    state.pushGap({
      code: 'duplicate_reference',
      message: 'duplicate claim ref',
      values: [truncateForGap(candidate.ref)],
    })
    return
  }

  const evidenceIds = resolveExcerptRefs(state, scope, candidate.evidenceRefs)
  if (candidate.kind !== 'inference' && evidenceIds.length === 0) {
    state.pushGap({
      code: 'unresolved_reference',
      message: 'claim references no admitted excerpt',
      values: [truncateForGap(candidate.ref)],
    })
    return
  }

  const id = ClaimIdSchema.parse(`clm-${state.claimCounter + 1}`)
  state.claimCounter += 1
  state.claims.push(buildClaim(candidate, id, evidenceIds))
  state.claimIdByRef.set(referenceKey, id)
}

function buildClaim(
  candidate: ResearchClaimCandidate,
  id: ClaimId,
  evidenceIds: readonly EvidenceExcerptId[]
): ResearchClaim {
  const stem = {
    id,
    section: candidate.section,
    statement: truncateOnCodePoint(candidate.statement, MAX_CLAIM_CHARS),
    evidenceIds,
  }
  const forecast =
    candidate.kind !== 'inference' && candidate.forecast === true ? { forecast: true as const } : {}

  if (candidate.kind === 'numeric') {
    return {
      ...stem,
      kind: 'numeric',
      basis: 'extractive',
      number: { ...candidate.number },
      ...forecast,
    }
  }
  return candidate.kind === 'factual'
    ? { ...stem, kind: 'factual', basis: 'extractive', ...forecast }
    : { ...stem, kind: 'inference', basis: 'model_inference' }
}

function resolveExcerptRefs(
  state: ResolutionState,
  scope: string,
  refs: readonly string[]
): readonly EvidenceExcerptId[] {
  const resolved: EvidenceExcerptId[] = []
  for (const ref of refs) {
    const id = state.excerptIdByRef.get(candidateReferenceKey(scope, ref))
    if (id === undefined) {
      state.pushGap({
        code: 'unresolved_reference',
        message: 'evidence ref does not resolve to an admitted excerpt',
        values: [truncateForGap(ref)],
      })
      continue
    }
    resolved.push(id)
  }
  return resolved
}

function resolveNumericLink(
  state: ResolutionState,
  scope: string,
  candidate: NumericEvidenceLinkCandidate
): void {
  const claimId = state.claimIdByRef.get(candidateReferenceKey(scope, candidate.claimRef))
  const excerptId = state.excerptIdByRef.get(candidateReferenceKey(scope, candidate.excerptRef))
  if (claimId === undefined || excerptId === undefined) {
    state.pushGap({
      code: 'unresolved_reference',
      message: 'numeric link references an unresolved claim or excerpt',
      values: [truncateForGap(candidate.claimRef), truncateForGap(candidate.excerptRef)],
    })
    return
  }
  state.numericLinks.push({
    claimId,
    excerptId,
    valueText: candidate.valueText,
    unitText: candidate.unitText,
    dateText: candidate.dateText,
  })
}

function resolveGap(state: ResolutionState, scope: string, candidate: EvidenceGapCandidate): void {
  state.pushGap({
    code: candidate.code,
    message: candidate.message,
    claimIds: resolveClaimRefs(state, scope, candidate.claimRefs),
    excerptIds: resolveExcerptRefs(state, scope, candidate.excerptRefs),
    sourceIds: resolveSourceRefs(state, candidate.sourceRefs),
    values: candidate.values,
    ...(candidate.params?.reason === undefined ? {} : { reason: candidate.params.reason }),
  })
}

function resolveClaimRefs(
  state: ResolutionState,
  scope: string,
  refs: readonly string[]
): readonly ClaimId[] {
  const resolved: ClaimId[] = []
  for (const ref of refs) {
    const id = state.claimIdByRef.get(candidateReferenceKey(scope, ref))
    if (id !== undefined) {
      resolved.push(id)
    }
  }
  return resolved
}

function resolveSourceRefs(state: ResolutionState, refs: readonly string[]): readonly SourceId[] {
  const resolved: SourceId[] = []
  for (const ref of refs) {
    const canonical = canonicalizeResearchUrl(ref)
    const id = canonical === undefined ? undefined : state.sourceIdByUrl.get(canonical)
    if (id !== undefined) {
      resolved.push(id)
    }
  }
  return resolved
}

export function buildResearchSource(input: BuildResearchSourceInput): ResearchSource {
  const { candidate } = input
  const metadata = [candidate.title, candidate.publisher, candidate.owner, candidate.author]
    .filter((value): value is string => value !== undefined)
    .join('\n')

  return {
    id: input.id,
    canonicalUrl: input.canonicalUrl,
    title: truncateOnCodePoint(candidate.title, MAX_CLAIM_CHARS),
    kind: candidate.kind,
    ...(candidate.publisher === undefined ? {} : { publisher: candidate.publisher }),
    ...(candidate.owner === undefined ? {} : { owner: candidate.owner }),
    ...(candidate.author === undefined ? {} : { author: candidate.author }),
    ...resolveDateFields(candidate),
    retrievedAt: input.now,
    discovery: candidate.discovery,
    safety: classifySafety(metadata),
    availability: 'available',
  }
}

export function applySourceFreshness(input: ApplySourceFreshnessInput): FreshEvidenceSet {
  const rejectedSources = new Set<SourceId>()
  const gaps: EvidenceGap[] = []

  for (const source of input.sources) {
    const disposition = freshnessDisposition(source, input.freshness)
    if (disposition === 'admit') {
      continue
    }
    gaps.push(freshnessGap(source, disposition))
    if (disposition === 'reject') {
      rejectedSources.add(source.id)
    }
  }

  const sources = input.sources.filter((source) => !rejectedSources.has(source.id))
  const rejectedExcerpts = new Set(
    input.excerpts
      .filter((excerpt) => rejectedSources.has(excerpt.sourceId))
      .map((excerpt) => excerpt.id)
  )
  const excerpts = input.excerpts.filter((excerpt) => !rejectedExcerpts.has(excerpt.id))
  const claims = input.claims.flatMap((claim) => retainClaim(claim, rejectedExcerpts))
  const claimIds = new Set(claims.map((claim) => claim.id))
  const numericLinks = input.numericLinks.filter(
    (link) => claimIds.has(link.claimId) && !rejectedExcerpts.has(link.excerptId)
  )
  return { sources, excerpts, claims, numericLinks, gaps }
}

// A source date is only usable with its provenance and confidence: freshness policy reads all
// three, so a day without them is dropped rather than admitted as an unqualified date.
function resolveDateFields(candidate: ResearchSourceCandidate): ResolvedDateFields {
  const hasDay = candidate.publishedOn !== undefined || candidate.updatedOn !== undefined
  if (!hasDay || candidate.dateProvenance === undefined || candidate.dateConfidence === undefined) {
    return {}
  }
  return {
    ...(candidate.publishedOn === undefined ? {} : { publishedOn: candidate.publishedOn }),
    ...(candidate.updatedOn === undefined ? {} : { updatedOn: candidate.updatedOn }),
    dateProvenance: candidate.dateProvenance,
    dateConfidence: candidate.dateConfidence,
  }
}

function freshnessGap(
  source: ResearchSource,
  disposition: 'admit_with_penalty' | 'reject'
): EvidenceGap {
  const rejected = disposition === 'reject'

  return createGap({
    code: rejected ? 'freshness_out_of_window' : 'freshness_uncertain',
    message: rejected
      ? 'source date is outside the requested freshness window'
      : 'source date is uncertain or absent for a time-sensitive claim',
    sourceIds: [source.id],
  })
}

function retainClaim(
  claim: ResearchClaim,
  rejectedExcerpts: ReadonlySet<EvidenceExcerpt['id']>
): readonly ResearchClaim[] {
  const evidenceIds = claim.evidenceIds.filter((id) => !rejectedExcerpts.has(id))
  return evidenceIds.length === 0 ? [] : [{ ...claim, evidenceIds }]
}

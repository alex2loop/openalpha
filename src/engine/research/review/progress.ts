import type { ResearchReview } from '../contracts'
import type { AdmittedEvidence, ClaimId } from '../evidence/model'
import { claimIdentityKey } from '../evidence/coverage'

// Claim ids are reassigned during admission, so revision progress compares semantic identity.
export function isRevisionProgress(previous: AdmittedEvidence, next: AdmittedEvidence): boolean {
  const previousSupport = supportingUrlsByClaim(previous)

  for (const [claim, urls] of supportingUrlsByClaim(next)) {
    const priorUrls = previousSupport.get(claim)

    if (priorUrls === undefined) {
      return true
    }
    for (const url of urls) {
      if (!priorUrls.has(url)) {
        return true
      }
    }
  }

  return hasResolvedClaimGap(previous, next) || hasResolvedConflict(previous, next)
}

function supportingUrlsByClaim(evidence: AdmittedEvidence): Map<string, Set<string>> {
  const urlsBySource = new Map(evidence.sources.map((source) => [source.id, source.canonicalUrl]))
  const excerptsById = new Map(evidence.excerpts.map((excerpt) => [excerpt.id, excerpt]))
  const support = new Map<string, Set<string>>()

  for (const claim of evidence.claims) {
    const key = claimIdentityKey(claim)
    const urls = support.get(key) ?? new Set<string>()

    for (const evidenceId of claim.evidenceIds) {
      const sourceId = excerptsById.get(evidenceId)?.sourceId
      const url = sourceId === undefined ? undefined : urlsBySource.get(sourceId)

      if (url !== undefined) {
        urls.add(url)
      }
    }
    support.set(key, urls)
  }
  return support
}

function hasResolvedClaimGap(previous: AdmittedEvidence, next: AdmittedEvidence): boolean {
  const nextClaims = new Set(next.claims.map(claimIdentityKey))
  const nextShapes = new Set(next.gaps.map((gap) => referenceShape(gap, next)))

  return previous.gaps.some(
    (gap) =>
      referenceClaimsSurvive(gap, previous, nextClaims) &&
      !nextShapes.has(referenceShape(gap, previous))
  )
}

function hasResolvedConflict(previous: AdmittedEvidence, next: AdmittedEvidence): boolean {
  const nextClaims = new Set(next.claims.map(claimIdentityKey))
  const nextShapes = new Set(next.conflicts.map((conflict) => referenceShape(conflict, next)))

  return previous.conflicts.some(
    (conflict) =>
      referenceClaimsSurvive(conflict, previous, nextClaims) &&
      !nextShapes.has(referenceShape(conflict, previous))
  )
}

function referenceClaimsSurvive(
  reference: { readonly claimIds: readonly ClaimId[] },
  evidence: AdmittedEvidence,
  nextClaims: ReadonlySet<string>
): boolean {
  const claims = claimIdentities(reference.claimIds, evidence)
  return claims.length > 0 && claims.every((claim) => nextClaims.has(claim))
}

function referenceShape(
  reference: { readonly code: string; readonly claimIds: readonly ClaimId[] },
  evidence: AdmittedEvidence
): string {
  return JSON.stringify([reference.code, [...claimIdentities(reference.claimIds, evidence)].sort()])
}

function claimIdentities(claimIds: readonly ClaimId[], evidence: AdmittedEvidence): string[] {
  const claimsById = new Map(evidence.claims.map((claim) => [claim.id, claim]))

  return claimIds.flatMap((claimId) => {
    const claim = claimsById.get(claimId)
    return claim === undefined ? [] : [claimIdentityKey(claim)]
  })
}

// Re-admission reassigns claim ids, so a review's id lists re-anchor through the same identity
// keys isRevisionProgress compares; matching raw ids across two admissions couples correctness
// to admission order.
export function reviewClaimKeys(
  state: { readonly review: ResearchReview; readonly evidence: AdmittedEvidence },
  pick: (review: ResearchReview) => readonly ClaimId[]
): ReadonlySet<string> {
  const ids = new Set(pick(state.review))

  return new Set(claimIdentities([...ids], state.evidence))
}

export function matchingClaimIds(
  evidence: AdmittedEvidence,
  keys: ReadonlySet<string>
): readonly ClaimId[] {
  return evidence.claims.flatMap((claim) => (keys.has(claimIdentityKey(claim)) ? [claim.id] : []))
}

import type { ResearchSourceKind } from '../evidence/model'
import type { ResearchSourceCandidate } from '../evidence/schemas'
import type { ResearchRetrievedSource } from '../retrieval/material'
import { PRIMARY_SOURCE_KINDS } from '../evidence/model'
import { hasNormalizedText } from '../evidence/normalize'

interface ToSourceCandidateInput {
  readonly discovered: ResearchRetrievedSource
  readonly kind: ResearchSourceKind | undefined
  readonly publisher: string | undefined
  readonly owner: string | undefined
}

export function toSourceCandidate(input: ToSourceCandidateInput): ResearchSourceCandidate {
  const { discovered, kind, publisher, owner } = input
  const groundedPublisher = groundedSourceMetadata(discovered, publisher)
  const groundedOwner = groundedSourceMetadata(discovered, owner)

  return {
    url: discovered.url,
    title: discovered.title,
    kind: resolveSourceKind(kind),
    discovery: discovered.discovery,
    ...(groundedPublisher === undefined ? {} : { publisher: groundedPublisher }),
    ...(groundedOwner === undefined ? {} : { owner: groundedOwner }),
    ...(discovered.author === undefined ? {} : { author: discovered.author }),
    ...toSourceDateFields(discovered),
  }
}

// Authority is never self-reported: a claimed primary class is recorded as secondary, so the
// rendered source kind never repeats an assertion the page made about itself.
function resolveSourceKind(claimed: ResearchSourceKind | undefined): ResearchSourceKind {
  return claimed === undefined || PRIMARY_SOURCE_KINDS.has(claimed) ? 'secondary' : claimed
}

function groundedSourceMetadata(
  source: ResearchRetrievedSource,
  value: string | undefined
): string | undefined {
  const material = `${source.title}\n${source.content ?? ''}`
  if (value === undefined || !hasNormalizedText(material, value)) {
    return undefined
  }
  return value
}

// The day, provenance, and confidence tuple is all-or-none; author is independent of it.
function toSourceDateFields(
  discovered: ResearchRetrievedSource
): Pick<ResearchSourceCandidate, 'publishedOn' | 'dateProvenance' | 'dateConfidence'> {
  if (
    discovered.publishedOn === undefined ||
    discovered.dateProvenance === undefined ||
    discovered.dateConfidence === undefined
  ) {
    return {}
  }

  return {
    publishedOn: discovered.publishedOn,
    dateProvenance: discovered.dateProvenance,
    dateConfidence: discovered.dateConfidence,
  }
}

export function mergeSourceMetadata(
  existing: ResearchSourceCandidate,
  candidate: ResearchSourceCandidate
): ResearchSourceCandidate {
  return {
    ...existing,
    ...(existing.publisher === undefined && candidate.publisher !== undefined
      ? { publisher: candidate.publisher }
      : {}),
    ...(existing.owner === undefined && candidate.owner !== undefined
      ? { owner: candidate.owner }
      : {}),
  }
}

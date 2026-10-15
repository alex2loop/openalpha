import type { ClaimId, EvidenceExcerpt, ResearchClaim, ResearchSource } from './model'

const WWW_PREFIX = 'www.'

interface CorroborationEvidence {
  readonly sources: readonly ResearchSource[]
  readonly excerpts: readonly EvidenceExcerpt[]
  readonly claims: readonly ResearchClaim[]
}

interface SupportCluster {
  readonly hosts: Set<string>
  readonly hashes: Set<string>
}

/**
 * Independent publishers behind each claim. An excerpt supports through its source's host, and
 * hosts carrying byte-identical excerpt text (equal textHash) are one syndicated origin — a wire
 * story reprinted on five domains corroborates once. Clusters merge on shared host or shared
 * hash; the cluster count is the number of independent supports.
 */
export function independentSupportCounts(
  evidence: CorroborationEvidence
): ReadonlyMap<ClaimId, number> {
  const hostBySource = new Map<string, string>()
  for (const source of evidence.sources) {
    hostBySource.set(source.id, publisherHost(source.canonicalUrl))
  }
  const excerptsById = new Map(evidence.excerpts.map((excerpt) => [excerpt.id, excerpt]))

  const counts = new Map<ClaimId, number>()
  for (const claim of evidence.claims) {
    counts.set(claim.id, supportClusters(claim, excerptsById, hostBySource).length)
  }
  return counts
}

function supportClusters(
  claim: ResearchClaim,
  excerptsById: ReadonlyMap<string, EvidenceExcerpt>,
  hostBySource: ReadonlyMap<string, string>
): readonly SupportCluster[] {
  const clusters: SupportCluster[] = []
  for (const excerptId of claim.evidenceIds) {
    const excerpt = excerptsById.get(excerptId)
    const host = excerpt === undefined ? undefined : hostBySource.get(excerpt.sourceId)
    if (excerpt === undefined || host === undefined) {
      continue
    }
    mergeIntoClusters(clusters, host, excerpt.textHash)
  }
  return clusters
}

function mergeIntoClusters(clusters: SupportCluster[], host: string, hash: string): void {
  const matched = clusters.filter((cluster) => cluster.hosts.has(host) || cluster.hashes.has(hash))
  const target = matched[0]

  if (target === undefined) {
    clusters.push({ hosts: new Set([host]), hashes: new Set([hash]) })
    return
  }

  target.hosts.add(host)
  target.hashes.add(hash)
  for (const extra of matched.slice(1)) {
    for (const value of extra.hosts) {
      target.hosts.add(value)
    }
    for (const value of extra.hashes) {
      target.hashes.add(value)
    }
    clusters.splice(clusters.indexOf(extra), 1)
  }
}

// canonicalizeResearchUrl already lowercased the host; a www prefix is presentation, not identity.
function publisherHost(canonicalUrl: string): string {
  const hostname = new URL(canonicalUrl).hostname
  return hostname.startsWith(WWW_PREFIX) ? hostname.slice(WWW_PREFIX.length) : hostname
}

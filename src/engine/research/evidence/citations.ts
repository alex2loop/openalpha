import type {
  AdmittedEvidence,
  ClaimId,
  EvidenceExcerpt,
  ReportSection,
  ResearchArtifact,
  ResearchClaim,
  ResearchReport,
  ResearchSource,
  SourceId,
} from './model'
import type { ResearchReportCandidate } from './schemas'
import { REPORT_SECTIONS } from './model'

const TRAILING_SLASH_RE = /\/$/
const TRAILING_HOSTNAME_DOT_RE = /\.$/

interface ReportResolutionState {
  readonly claimsBySection: ReadonlyMap<ReportSection, readonly ResearchClaim[]>
  readonly issues: string[]
}

interface SourceOrderState {
  readonly excerptsById: ReadonlyMap<string, EvidenceExcerpt>
  readonly sourcesById: ReadonlyMap<string, ResearchSource>
  readonly seen: Set<string>
  readonly ordered: ResearchSource[]
}

type ResearchReportResolution =
  | { readonly kind: 'value'; readonly report: ResearchReport }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }

export function canonicalizeResearchUrl(raw: string): string | undefined {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return undefined
  }

  if (url.protocol !== 'https:') {
    return undefined
  }

  url.hash = ''
  url.hostname = normalizeResearchHostname(url.hostname)
  if (url.port === '443') {
    url.port = ''
  }
  if (url.pathname === '/') {
    url.pathname = ''
  }
  url.searchParams.sort()
  return url.toString().replace(TRAILING_SLASH_RE, '')
}

function normalizeResearchHostname(hostname: string): string {
  return hostname.toLowerCase().replace(TRAILING_HOSTNAME_DOT_RE, '')
}

export function resolveResearchReport(
  candidate: ResearchReportCandidate,
  evidence: AdmittedEvidence
): ResearchReportResolution {
  const claimsBySection = groupClaimsBySection(evidence.claims)
  const issues: string[] = []
  const state = { claimsBySection, issues }
  const report: ResearchReport = {
    answer: resolveSection(candidate.answer, 'answer', state),
    keyEvidence: resolveSection(candidate.keyEvidence, 'keyEvidence', state),
    risks: resolveSection(candidate.risks, 'risks', state),
    conflicts: resolveSection(candidate.conflicts, 'conflicts', state),
    practicalConsiderations: resolveSection(
      candidate.practicalConsiderations,
      'practicalConsiderations',
      state
    ),
  }

  if (report.answer.length === 0) {
    issues.push('report answer must select at least one admitted answer claim')
  }

  return issues.length === 0 ? { kind: 'value', report } : { kind: 'invalid', issues }
}

export function buildResearchArtifact(
  evidence: AdmittedEvidence,
  report: ResearchReport
): Omit<ResearchArtifact, 'retrievalAttempts'> {
  return {
    ...evidence,
    sources: orderSourcesByReport(evidence, report),
    report,
  }
}

function groupClaimsBySection(
  claims: readonly ResearchClaim[]
): ReadonlyMap<ReportSection, readonly ResearchClaim[]> {
  const grouped = new Map<ReportSection, ResearchClaim[]>()

  for (const section of REPORT_SECTIONS) {
    grouped.set(section, [])
  }

  for (const claim of claims) {
    grouped.get(claim.section)?.push(claim)
  }

  return grouped
}

function resolveSection(
  positions: readonly number[],
  section: ReportSection,
  state: ReportResolutionState
): readonly ClaimId[] {
  const sectionClaims = state.claimsBySection.get(section) ?? []
  const resolved: ClaimId[] = []
  const seen = new Set<ClaimId>()

  for (const position of positions) {
    const claim = sectionClaims[position - 1]
    if (claim === undefined) {
      state.issues.push(
        `report section "${section}" position ${position} is out of range (1..${sectionClaims.length})`
      )
      continue
    }

    if (seen.has(claim.id)) {
      continue
    }

    seen.add(claim.id)
    resolved.push(claim.id)
  }

  return resolved
}

function orderSourcesByReport(
  evidence: AdmittedEvidence,
  report: ResearchReport
): readonly ResearchSource[] {
  const claimsById = new Map(evidence.claims.map((claim) => [claim.id, claim]))
  const state: SourceOrderState = {
    excerptsById: new Map(evidence.excerpts.map((excerpt) => [excerpt.id, excerpt])),
    sourcesById: new Map(evidence.sources.map((source) => [source.id, source])),
    seen: new Set(),
    ordered: [],
  }

  for (const claimId of reportClaimIds(report)) {
    const claim = claimsById.get(claimId)
    if (claim !== undefined) {
      appendClaimSources(claim, state)
    }
  }

  for (const source of evidence.sources) {
    appendSource(source.id, state)
  }

  return state.ordered
}

function reportClaimIds(report: ResearchReport): readonly ClaimId[] {
  return [
    ...report.answer,
    ...report.keyEvidence,
    ...report.risks,
    ...report.conflicts,
    ...report.practicalConsiderations,
  ]
}

function appendClaimSources(claim: ResearchClaim, state: SourceOrderState): void {
  for (const excerptId of claim.evidenceIds) {
    const excerpt = state.excerptsById.get(excerptId)
    if (excerpt !== undefined) {
      appendSource(excerpt.sourceId, state)
    }
  }
}

function appendSource(sourceId: SourceId, state: SourceOrderState): void {
  const source = state.sourcesById.get(sourceId)
  if (source !== undefined && !state.seen.has(sourceId)) {
    state.seen.add(sourceId)
    state.ordered.push(source)
  }
}

import type { EvidenceConflict, EvidenceGap } from './gaps'
import type {
  AdmittedEvidence,
  ClaimId,
  EvidenceExcerpt,
  EvidenceExcerptId,
  NumericEvidenceLink,
  ResearchClaim,
  ResearchSource,
  SourceId,
} from './model'
import { factualContradictions } from './contradiction'
import { createGap } from './gaps'
import { normalizeClaimKeyText } from './normalize'
import { missingNumericSpans } from './numeric'

const CLAIM_KEY_SEPARATOR = '\u0000'
const MIN_EXTENSION_TOKENS = 4
// The tokenizer splits "isn't" into "isn" + "t", so the lone "t" is the contraction marker.
const NEGATION_TOKENS: ReadonlySet<string> = new Set([
  'not',
  'no',
  'never',
  'without',
  'none',
  'nor',
  'cannot',
  't',
  'không',
  'chưa',
  'chẳng',
])

export interface CoverageResult {
  readonly claims: readonly ResearchClaim[]
  readonly numericLinks: readonly NumericEvidenceLink[]
  readonly gaps: readonly EvidenceGap[]
  readonly conflicts: readonly EvidenceConflict[]
}

interface CoverageIndexes {
  readonly sourcesByExcerpt: ReadonlyMap<EvidenceExcerptId, readonly ResearchSource[]>
  readonly excerptsById: ReadonlyMap<EvidenceExcerptId, EvidenceExcerpt>
  readonly numericLinksByClaim: ReadonlyMap<ClaimId, readonly NumericLinkDisposition[]>
}

type ClaimCoverage =
  | ({ readonly kind: 'supported' } & RetainedClaimCoverage)
  | ({ readonly kind: 'gap'; readonly gap: EvidenceGap } & RetainedClaimCoverage)
  | { readonly kind: 'conflict'; readonly conflict: EvidenceConflict }

type ExtractiveClaim = Extract<ResearchClaim, { readonly basis: 'extractive' }>

interface RetainedClaimCoverage {
  readonly claim: ExtractiveClaim
  readonly conflict?: EvidenceConflict
}

interface NumericLinkDisposition {
  readonly link: NumericEvidenceLink
  readonly exact: boolean
}

interface CoverageGapInput {
  readonly claim: ExtractiveClaim
  readonly sourceIds: readonly SourceId[]
  readonly message: string
}

export function validateClaimCoverage(evidence: AdmittedEvidence): CoverageResult {
  const consolidated = consolidateEvidenceClaims(evidence.claims, evidence.numericLinks)
  const excerptsById = new Map(evidence.excerpts.map((excerpt) => [excerpt.id, excerpt]))
  const indexes: CoverageIndexes = {
    sourcesByExcerpt: indexSourcesByExcerpt(evidence.sources, evidence.excerpts),
    excerptsById,
    numericLinksByClaim: indexNumericLinksByClaim(
      consolidated.claims,
      consolidated.numericLinks,
      excerptsById
    ),
  }
  const claims: ResearchClaim[] = []
  const gaps: EvidenceGap[] = []
  const conflicts: EvidenceConflict[] = []

  for (const claim of consolidated.claims) {
    if (claim.kind === 'inference') {
      if (claim.evidenceIds.length > 0) {
        claims.push(claim)
      }
      continue
    }

    const outcome = coverageForClaim(claim, indexes)
    if (outcome.kind === 'conflict') {
      conflicts.push(outcome.conflict)
      continue
    }
    if (outcome.kind === 'gap') {
      gaps.push(outcome.gap)
      continue
    }
    if (outcome.conflict !== undefined) {
      conflicts.push(outcome.conflict)
    }
    claims.push(outcome.claim)
  }

  return {
    claims,
    numericLinks: exactNumericLinks(claims, consolidated.numericLinks, indexes),
    gaps: [...evidence.gaps.filter((gap) => !isCoverageGap(gap)), ...gaps],
    conflicts: [
      ...evidence.conflicts.filter((conflict) => !isCoverageConflict(conflict)),
      ...conflicts,
      ...factualContradictions(claims),
    ],
  }
}

function isCoverageGap(gap: EvidenceGap): boolean {
  return gap.claimIds.length > 0 && gap.code === 'missing_support'
}

function isCoverageConflict(conflict: EvidenceConflict): boolean {
  return conflict.code === 'numeric_mismatch' || conflict.code === 'factual_contradiction'
}

function consolidateEvidenceClaims(
  claims: readonly ResearchClaim[],
  numericLinks: readonly NumericEvidenceLink[]
) {
  const representatives: ResearchClaim[] = []
  const representativeByClaimId = new Map<ClaimId, ClaimId>()

  for (const claim of claims) {
    const existingIndex = representatives.findIndex((r) => isSameClaim(r, claim))

    if (existingIndex === -1) {
      representatives.push(claim)
      representativeByClaimId.set(claim.id, claim.id)
      continue
    }

    const existing = representatives[existingIndex]
    if (existing === undefined) {
      continue
    }

    representatives[existingIndex] = mergeClaimEvidence(existing, claim.evidenceIds)
    representativeByClaimId.set(claim.id, existing.id)
  }

  return {
    claims: representatives,
    numericLinks: numericLinks.map((link) => ({
      ...link,
      claimId: representativeByClaimId.get(link.claimId) ?? link.claimId,
    })),
  }
}

function isSameClaim(a: ResearchClaim, b: ResearchClaim): boolean {
  return claimKey(a) === claimKey(b) || isStatementExtension(a, b)
}

function isStatementExtension(a: ResearchClaim, b: ResearchClaim): boolean {
  if (a.kind !== 'factual' || b.kind !== 'factual' || a.section !== b.section) {
    return false
  }

  const aTokens = statementTokens(a.statement)
  const bTokens = statementTokens(b.statement)
  const [smaller, larger] = aTokens.size <= bTokens.size ? [aTokens, bTokens] : [bTokens, aTokens]

  if (smaller.size < MIN_EXTENSION_TOKENS || smaller.size === larger.size) {
    return false
  }

  for (const token of smaller) {
    if (!larger.has(token)) {
      return false
    }
  }
  for (const token of larger) {
    if (!smaller.has(token) && NEGATION_TOKENS.has(token)) {
      return false
    }
  }
  return true
}

function statementTokens(statement: string): ReadonlySet<string> {
  return new Set(normalizeClaimKeyText(statement).split(' ').filter(Boolean))
}

function claimKey(claim: ResearchClaim): string {
  if (claim.kind === 'inference') {
    return ['inference', claim.id].join(CLAIM_KEY_SEPARATOR)
  }
  return claimIdentityKey(claim)
}

export function claimIdentityKey(claim: ResearchClaim): string {
  // A forecast never merges into the outcome it anticipates, however alike the wording.
  const forecast = claim.kind !== 'inference' && claim.forecast === true ? 'forecast' : 'stated'
  const parts = [claim.kind, forecast, claim.section, normalizeClaimKeyText(claim.statement)]
  if (claim.kind === 'numeric') {
    parts.push(
      claim.number.value,
      normalizeClaimKeyText(claim.number.unit),
      normalizeClaimKeyText(claim.number.scope),
      claim.number.effectiveOn
    )
  }
  return parts.join(CLAIM_KEY_SEPARATOR)
}

function mergeClaimEvidence(
  claim: ResearchClaim,
  evidenceIds: readonly EvidenceExcerptId[]
): ResearchClaim {
  return { ...claim, evidenceIds: [...new Set([...claim.evidenceIds, ...evidenceIds])] }
}

function coverageForClaim(claim: ExtractiveClaim, indexes: CoverageIndexes): ClaimCoverage {
  if (claim.kind === 'numeric') {
    return numericClaimCoverage(claim, indexes)
  }

  return factualClaimCoverage(
    claim,
    collectSupportingSources(claim.evidenceIds, indexes.sourcesByExcerpt)
  )
}

// Corroboration is reported, never graded: a cited claim is retained, and only an uncited one is
// a coverage gap. Source count and identity stay visible in the artifact for the reader to weigh.
function factualClaimCoverage(
  claim: ExtractiveClaim,
  supportingSources: readonly ResearchSource[]
): ClaimCoverage {
  if (supportingSources.length > 0) {
    return { kind: 'supported', claim }
  }

  return {
    kind: 'gap',
    claim,
    gap: coverageGap({ claim, sourceIds: [], message: 'claim has no supporting source' }),
  }
}

function coverageGap(input: CoverageGapInput): EvidenceGap {
  return createGap({
    code: 'missing_support',
    claimIds: [input.claim.id],
    excerptIds: input.claim.evidenceIds,
    sourceIds: input.sourceIds,
    message: input.message,
  })
}

function numericClaimCoverage(
  claim: Extract<ResearchClaim, { kind: 'numeric' }>,
  indexes: CoverageIndexes
): ClaimCoverage {
  const links = indexes.numericLinksByClaim.get(claim.id) ?? []
  if (links.length === 0) {
    return {
      kind: 'gap',
      claim,
      gap: createGap({
        code: 'missing_support',
        claimIds: [claim.id],
        excerptIds: claim.evidenceIds,
        message: 'numeric claim has no extractive evidence link',
      }),
    }
  }

  const exactEvidenceIds = [
    ...new Set(
      links
        .filter((entry) => entry.exact && claim.evidenceIds.includes(entry.link.excerptId))
        .map((entry) => entry.link.excerptId)
    ),
  ]
  const invalidLink = links.find(
    (entry) => !(entry.exact && claim.evidenceIds.includes(entry.link.excerptId))
  )
  if (exactEvidenceIds.length > 0) {
    const coverage = factualClaimCoverage(
      { ...claim, evidenceIds: exactEvidenceIds },
      collectSupportingSources(exactEvidenceIds, indexes.sourcesByExcerpt)
    )
    return invalidLink === undefined
      ? coverage
      : {
          ...coverage,
          conflict: numericMismatchConflict(claim, invalidLink.link, indexes.excerptsById),
        }
  }

  const witness = invalidLink?.link ?? links[0]?.link
  return {
    kind: 'conflict',
    conflict: numericMismatchConflict(claim, witness, indexes.excerptsById),
  }
}

function exactNumericLinks(
  claims: readonly ResearchClaim[],
  links: readonly NumericEvidenceLink[],
  indexes: CoverageIndexes
): readonly NumericEvidenceLink[] {
  const numericClaims = new Map(
    claims.flatMap((claim) => (claim.kind === 'numeric' ? [[claim.id, claim] as const] : []))
  )

  return links.filter((link) => {
    const claim = numericClaims.get(link.claimId)
    const disposition = indexes.numericLinksByClaim
      .get(link.claimId)
      ?.find((entry) => entry.link === link)
    return claim?.evidenceIds.includes(link.excerptId) && disposition?.exact === true
  })
}

function numericMismatchConflict(
  claim: Extract<ResearchClaim, { kind: 'numeric' }>,
  link: NumericEvidenceLink | undefined,
  excerptsById: ReadonlyMap<EvidenceExcerptId, EvidenceExcerpt>
): EvidenceConflict {
  const excerptId = link === undefined ? [] : [link.excerptId]
  const reason =
    link === undefined || !excerptsById.has(link.excerptId)
      ? 'excerpt_not_admitted'
      : 'link_text_mismatch'

  return {
    code: 'numeric_mismatch',
    claimIds: [claim.id],
    excerptIds: excerptId,
    params: { reason },
    message: 'numeric claim link is not grounded in its cited excerpt',
  }
}

function collectSupportingSources(
  evidenceIds: readonly EvidenceExcerptId[],
  sourcesByExcerpt: ReadonlyMap<EvidenceExcerptId, readonly ResearchSource[]>
): readonly ResearchSource[] {
  const collected: ResearchSource[] = []
  const seen = new Set<string>()
  for (const excerptId of evidenceIds) {
    const sources = sourcesByExcerpt.get(excerptId) ?? []
    for (const source of sources) {
      if (!seen.has(source.id)) {
        seen.add(source.id)
        collected.push(source)
      }
    }
  }
  return collected
}

function indexSourcesByExcerpt(
  sources: readonly ResearchSource[],
  excerpts: readonly EvidenceExcerpt[]
): ReadonlyMap<EvidenceExcerptId, readonly ResearchSource[]> {
  const sourcesById = new Map<string, ResearchSource>()
  for (const source of sources) {
    sourcesById.set(source.id, source)
  }

  const index = new Map<EvidenceExcerptId, ResearchSource[]>()
  for (const excerpt of excerpts) {
    const source = sourcesById.get(excerpt.sourceId)
    if (source !== undefined) {
      const list = index.get(excerpt.id) ?? []
      list.push(source)
      index.set(excerpt.id, list)
    }
  }
  return index
}

function indexNumericLinksByClaim(
  claims: readonly ResearchClaim[],
  numericLinks: readonly NumericEvidenceLink[],
  excerptsById: ReadonlyMap<EvidenceExcerptId, EvidenceExcerpt>
): ReadonlyMap<ClaimId, readonly NumericLinkDisposition[]> {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]))
  const textsBySource = indexExcerptTextsBySource(excerptsById)
  const index = new Map<ClaimId, NumericLinkDisposition[]>()
  for (const link of numericLinks) {
    const claim = claimsById.get(link.claimId)
    const excerpt = excerptsById.get(link.excerptId)
    // Source-level, mirroring admission: the anchor excerpt carries the figure while the unit or
    // date may sit in another quote of the same source.
    const exact =
      claim?.kind === 'numeric' &&
      excerpt !== undefined &&
      missingNumericSpans(
        {
          valueText: link.valueText,
          unitText: link.unitText,
          dateText: link.dateText,
        },
        textsBySource.get(excerpt.sourceId) ?? []
      ).length === 0
    const list = index.get(link.claimId) ?? []
    list.push({ link, exact })
    index.set(link.claimId, list)
  }
  return index
}

function indexExcerptTextsBySource(
  excerptsById: ReadonlyMap<EvidenceExcerptId, EvidenceExcerpt>
): ReadonlyMap<SourceId, readonly string[]> {
  const index = new Map<SourceId, string[]>()

  for (const excerpt of excerptsById.values()) {
    const texts = index.get(excerpt.sourceId) ?? []
    texts.push(excerpt.text)
    index.set(excerpt.sourceId, texts)
  }

  return index
}

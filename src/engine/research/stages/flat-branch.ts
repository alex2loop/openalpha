import type { ResolvedResearch } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'

import type { CompleteNumericSpans, NumericSpanText, SpanLookup } from '../evidence/numeric'
import type {
  EvidenceExcerptCandidate,
  EvidenceGapCandidate,
  FlatResearchBranch,
  NumericEvidenceLinkCandidate,
  ResearchClaimCandidate,
  ResearchEvidenceBranch,
  ResearchSourceCandidate,
} from '../evidence/schemas'
import type { ResearchRetrievedSource } from '../retrieval/material'
import type { GatherResult } from '../retrieval/types'
import { canonicalizeResearchUrl } from '../evidence/citations'
import {
  describeNormalizedMismatch,
  hasNormalizedText,
  locateVerbatimPassage,
  normalizeExcerptText,
  quoteOrigin,
} from '../evidence/normalize'
import {
  completeNumericSpans,
  describeMissingSpans,
  hasSpanInExcerpt,
  isValueTextContradicting,
  missingNumericSpans,
  NUMERIC_SPAN_FIELDS,
} from '../evidence/numeric'
import { addValidationGap, toGapCandidates } from './flat-gaps'
import { mergeSourceMetadata, toSourceCandidate } from './flat-source'

const FLAT_EXCERPT_LOCATOR = 'page'

type FlatClaim = FlatResearchBranch['claims'][number]
type FlatClaimSource = FlatClaim['sources'][number]

interface ToEvidenceBranchInput {
  readonly questionId: string
  readonly branch: FlatResearchBranch
  readonly material: GatherResult
  readonly researchConfig: ResolvedResearch
  readonly logger?: Logger
}

interface EvidenceAdmission {
  readonly logger?: Logger
  readonly discovered: ReadonlyMap<string, ResearchRetrievedSource>
  readonly researchConfig: ResolvedResearch
  readonly sources: ResearchSourceCandidate[]
  readonly sourceIndexes: Map<string, number>
  readonly excerpts: EvidenceExcerptCandidate[]
  readonly excerptKeys: Map<string, string>
  readonly claims: ResearchClaimCandidate[]
  readonly numericLinks: NumericEvidenceLinkCandidate[]
  readonly numericLinkKeys: Set<string>
  readonly gaps: EvidenceGapCandidate[]
  readonly validationGapKeys: Set<string>
}

interface ClaimSourceEvidence {
  readonly evidenceRefs: readonly string[]
  readonly numericLinkRefs: readonly string[]
}

interface AdmittedQuote {
  readonly ref: string
  readonly text: string
}

interface AdmitClaimSourceInput {
  readonly admission: EvidenceAdmission
  readonly claimRef: string
  readonly source: FlatClaimSource
  readonly numericSpans: NumericSpanText | undefined
}

interface AdmitSourceQuotesInput {
  readonly admission: EvidenceAdmission
  readonly source: ResearchRetrievedSource
  readonly sourceKey: string
  readonly sourceRef: string
  readonly quotes: readonly string[]
  readonly claimRef: string
  readonly numericSpans: NumericSpanText | undefined
}

interface AdmitNumericLinksInput {
  readonly admission: EvidenceAdmission
  readonly sourceRef: string
  readonly claimRef: string
  readonly numericSpans: NumericSpanText | undefined
  readonly admitted: readonly AdmittedQuote[]
  readonly content: string
}

interface AdmitQuoteInput {
  readonly admission: EvidenceAdmission
  readonly sourceKey: string
  readonly source: ResearchRetrievedSource
  readonly sourceRef: string
  readonly quote: string
}

interface AdmitNumericLinkInput {
  readonly admission: EvidenceAdmission
  readonly claimRef: string
  readonly excerptRef: string
  readonly spans: CompleteNumericSpans
}

interface AdmitSourceInput {
  readonly admission: EvidenceAdmission
  readonly key: string
  readonly source: ResearchRetrievedSource
  readonly sourceCandidate: FlatClaimSource
}

// Maps the crawler's nested output into the ref-graph candidate shape. The adapter owns every id
// and cross-reference; the model authors only claim meaning and source-owned evidence.
export function toEvidenceBranch(input: ToEvidenceBranchInput): ResearchEvidenceBranch {
  const admission = createEvidenceAdmission(input)

  for (const [claimIndex, claim] of input.branch.claims.entries()) {
    admitClaim(admission, claim, claimIndex)
  }

  return {
    questionId: input.questionId,
    sources: admission.sources,
    excerpts: admission.excerpts,
    claims: admission.claims,
    numericLinks: admission.numericLinks,
    gaps: admission.gaps,
  }
}

function createEvidenceAdmission(input: ToEvidenceBranchInput): EvidenceAdmission {
  const discovered = new Map<string, ResearchRetrievedSource>()

  for (const source of input.material.sources) {
    const canonicalUrl = canonicalizeResearchUrl(source.url)
    if (canonicalUrl !== undefined) {
      discovered.set(canonicalUrl, source)
    }
  }

  return {
    ...(input.logger === undefined ? {} : { logger: input.logger }),
    discovered,
    researchConfig: input.researchConfig,
    sources: [],
    sourceIndexes: new Map<string, number>(),
    excerpts: [],
    excerptKeys: new Map<string, string>(),
    claims: [],
    numericLinks: [],
    numericLinkKeys: new Set<string>(),
    gaps: toGapCandidates(input.branch.gaps),
    validationGapKeys: new Set<string>(),
  }
}

function admitClaim(admission: EvidenceAdmission, claim: FlatClaim, claimIndex: number): void {
  const claimRef = `c${claimIndex + 1}`
  const sourceEvidence = claim.sources.map((source) =>
    admitClaimSource({
      admission,
      claimRef,
      source,
      numericSpans: numericSpansForSource(claim, source),
    })
  )
  const evidenceRefs = uniqueRefs(sourceEvidence.flatMap((result) => result.evidenceRefs))
  const numericLinkRefs = uniqueRefs(sourceEvidence.flatMap((result) => result.numericLinkRefs))

  if (claim.kind === 'numeric') {
    if (numericLinkRefs.length === 0) {
      return
    }
    admission.claims.push(toClaimCandidate(claim, claimRef, numericLinkRefs))
    return
  }

  if (evidenceRefs.length > 0) {
    admission.claims.push(toClaimCandidate(claim, claimRef, evidenceRefs))
  }
}

function numericSpansForSource(
  claim: FlatClaim,
  source: FlatClaimSource
): NumericSpanText | undefined {
  if (claim.kind !== 'numeric' || !('numericSpans' in source)) {
    return undefined
  }
  return { ...source.numericSpans, claimValue: claim.number.value }
}

function admitClaimSource(input: AdmitClaimSourceInput): ClaimSourceEvidence {
  const key = canonicalizeResearchUrl(input.source.url)
  const source = key === undefined ? undefined : input.admission.discovered.get(key)

  if (key === undefined || source === undefined) {
    addValidationGap(input.admission, {
      reason: 'source_not_retrieved',
      values: [input.source.url],
    })
    return { evidenceRefs: [], numericLinkRefs: [] }
  }

  admitSource({
    admission: input.admission,
    key,
    source,
    sourceCandidate: input.source,
  })
  return admitSourceQuotes({
    admission: input.admission,
    source,
    sourceKey: key,
    sourceRef: input.source.url,
    quotes: input.source.quotes,
    claimRef: input.claimRef,
    numericSpans: input.numericSpans,
  })
}

function admitSourceQuotes(input: AdmitSourceQuotesInput): ClaimSourceEvidence {
  const evidenceRefs = new Set<string>()
  const admitted: AdmittedQuote[] = []

  for (const quote of input.quotes) {
    const excerpt = admitQuote({
      admission: input.admission,
      sourceKey: input.sourceKey,
      source: input.source,
      sourceRef: input.sourceRef,
      quote,
    })
    if (excerpt === undefined) {
      continue
    }

    evidenceRefs.add(excerpt.ref)
    admitted.push(excerpt)
  }

  return {
    evidenceRefs: [...evidenceRefs],
    numericLinkRefs: admitNumericLinks({
      admission: input.admission,
      sourceRef: input.sourceRef,
      claimRef: input.claimRef,
      numericSpans: input.numericSpans,
      admitted,
      content: input.source.content ?? '',
    }),
  }
}

function admitNumericLinks(input: AdmitNumericLinksInput): readonly string[] {
  if (input.numericSpans === undefined) {
    return []
  }

  const spans = completeNumericSpans(input.numericSpans)

  if (spans === undefined) {
    addValidationGap(input.admission, {
      reason: 'numeric_source_undated',
      values: [input.sourceRef],
    })
    return []
  }

  return resolveNumericEvidence(input, spans)
}

// Spans are sought across every quote this source contributed, not within one: a page routinely
// prints the figure in a table and its date in the headline. The link anchors to the figure, but
// the claim cites every span-bearing excerpt — the reviewer judges a claim from its cited excerpts
// alone, so an anchor holding the number without its unit or date reads as unsupported.
function resolveNumericEvidence(
  input: AdmitNumericLinksInput,
  spans: CompleteNumericSpans
): readonly string[] {
  const lookup: SpanLookup = {
    quotes: input.admitted.map((excerpt) => excerpt.text),
    page: input.content,
  }
  const anchor = input.admitted.find((excerpt) =>
    hasSpanInExcerpt(excerpt.text, 'valueText', spans.valueText)
  )
  const contradicted =
    spans.claimValue !== undefined && isValueTextContradicting(spans.claimValue, spans.valueText)

  if (anchor === undefined || contradicted) {
    addValidationGap(input.admission, {
      reason: 'numeric_value_not_in_quotes',
      values: [input.sourceRef],
      detail: describeMissingSpans(spans, ['valueText'], lookup),
    })
    return []
  }

  const missing = missingNumericSpans(spans, lookup.quotes)

  if (missing.length > 0) {
    addValidationGap(input.admission, {
      reason: 'numeric_fields_absent',
      values: [input.sourceRef, ...missing],
      detail: describeMissingSpans(spans, missing, lookup),
    })
    return []
  }

  admitNumericLink({
    admission: input.admission,
    claimRef: input.claimRef,
    excerptRef: anchor.ref,
    spans,
  })

  return input.admitted
    .filter((excerpt) =>
      NUMERIC_SPAN_FIELDS.some((field) => hasSpanInExcerpt(excerpt.text, field, spans[field]))
    )
    .map((excerpt) => excerpt.ref)
}

function admitSource(input: AdmitSourceInput): void {
  const candidate = toSourceCandidate({
    discovered: input.source,
    kind: input.sourceCandidate.kind,
    publisher: input.sourceCandidate.publisher,
    owner: input.sourceCandidate.owner,
  })
  const existingIndex = input.admission.sourceIndexes.get(input.key)

  if (existingIndex !== undefined) {
    const existing = input.admission.sources[existingIndex]
    if (existing !== undefined) {
      input.admission.sources[existingIndex] = mergeSourceMetadata(existing, candidate)
    }
    return
  }

  input.admission.sourceIndexes.set(input.key, input.admission.sources.length)
  input.admission.sources.push(candidate)
}

function admitQuote(input: AdmitQuoteInput): AdmittedQuote | undefined {
  const content = input.source.content

  if (content === undefined) {
    addValidationGap(input.admission, { reason: 'source_content_empty', values: [input.sourceRef] })
    return undefined
  }

  const quote = groundedQuote(input, content)

  if (quote === undefined) {
    return undefined
  }

  const excerptKey = `${input.sourceKey}\u0000${normalizeExcerptText(quote)}`
  const existing = input.admission.excerptKeys.get(excerptKey)
  if (existing !== undefined) {
    const excerpt = input.admission.excerpts.find((candidate) => candidate.ref === existing)
    return excerpt === undefined ? undefined : { ref: existing, text: excerpt.text }
  }

  const ref = `e${input.admission.excerpts.length + 1}`
  input.admission.excerptKeys.set(excerptKey, ref)
  input.admission.excerpts.push({
    ref,
    sourceRef: input.sourceRef,
    text: quote,
    locator: FLAT_EXCERPT_LOCATOR,
    truncated: quote !== input.quote,
  })
  return { ref, text: quote }
}

// A quote that fails containment is re-anchored to the closest verbatim passage; only a quote
// matching nothing on the page is rejected as invented.
function groundedQuote(input: AdmitQuoteInput, content: string): string | undefined {
  if (hasNormalizedText(content, input.quote)) {
    return input.quote
  }

  const reanchored = locateVerbatimPassage(content, input.quote)

  addValidationGap(input.admission, {
    reason: reanchored === undefined ? 'quote_not_in_content' : 'quote_reanchored',
    values: [input.sourceRef],
    detail: {
      quote: input.quote,
      ...describeNormalizedMismatch(content, input.quote),
      origin: quoteOrigin({ quote: input.quote, snippet: input.source.snippet, content }),
    },
  })

  return reanchored
}

function admitNumericLink(input: AdmitNumericLinkInput): void {
  const key = `${input.claimRef}\u0000${input.excerptRef}`
  if (input.admission.numericLinkKeys.has(key)) {
    return
  }

  input.admission.numericLinkKeys.add(key)
  input.admission.numericLinks.push({
    claimRef: input.claimRef,
    excerptRef: input.excerptRef,
    valueText: input.spans.valueText,
    unitText: input.spans.unitText,
    dateText: input.spans.dateText,
  })
}

function toClaimCandidate(
  claim: FlatClaim,
  claimRef: string,
  evidenceRefs: readonly string[]
): ResearchClaimCandidate {
  const stem = { ref: claimRef, section: claim.section, statement: claim.statement, evidenceRefs }

  switch (claim.kind) {
    case 'factual':
      return { ...stem, kind: 'factual', basis: 'extractive', ...forecastField(claim.forecast) }
    case 'numeric':
      return {
        ...stem,
        kind: 'numeric',
        basis: 'extractive',
        number: claim.number,
        ...forecastField(claim.forecast),
      }
    case 'inference':
      return { ...stem, kind: 'inference', basis: 'model_inference' }
  }
}

function forecastField(forecast: boolean | undefined): { readonly forecast?: true } {
  return forecast === true ? { forecast: true } : {}
}

function uniqueRefs(refs: readonly string[]): readonly string[] {
  return [...new Set(refs)]
}

import { sha256Hex } from '@/core/utils/hash'

import type { CreateGapInput, EvidenceGap } from './gaps'
import type {
  AdmittedEvidence,
  ClaimId,
  EvidenceExcerpt,
  EvidenceExcerptId,
  NumericEvidenceLink,
  ResearchClaim,
  ResearchFreshness,
  ResearchSource,
  SourceId,
} from './model'
import type { EvidenceExcerptCandidate, ResearchEvidenceBranch } from './schemas'
import { MAX_LOCATOR_CHARS } from '../contracts'
import { canonicalizeResearchUrl } from './citations'
import { createGap } from './gaps'
import { EvidenceExcerptIdSchema, SourceIdSchema } from './model'
import {
  classifySafety,
  normalizeExcerptText,
  truncateAtSentenceBoundary,
  truncateForGap,
  truncateOnCodePoint,
} from './normalize'
import {
  applySourceFreshness,
  buildResearchSource,
  candidateBranchScope,
  candidateReferenceKey,
  type ResolutionState,
  resolveClaims,
  resolveGaps,
  resolveNumericLinks,
} from './resolve'

interface ResearchEvidenceBounds {
  readonly maxExcerptChars: number
  readonly maxExcerptsPerSource: number
  readonly maxArtifactBytes: number
}

interface EvidenceAdmissionInput {
  readonly candidates: readonly ResearchEvidenceBranch[]
  readonly freshness?: ResearchFreshness
  readonly bounds: ResearchEvidenceBounds
  readonly now: number
  readonly signal: AbortSignal
}

type EvidenceAdmissionResult =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'admitted'; readonly evidence: AdmittedEvidence }
  | {
      readonly kind: 'failed'
      readonly code: 'insufficient_evidence'
      readonly sources: readonly ResearchSource[]
      readonly gaps: readonly EvidenceGap[]
    }

/** Canonical evidence admission: normalize, resolve, validate, and bound one run's artifact. */
export async function admitEvidence(
  input: EvidenceAdmissionInput
): Promise<EvidenceAdmissionResult> {
  if (input.signal.aborted) {
    return { kind: 'cancelled' }
  }

  const state = new EvidenceAdmissionState(input.bounds, input.now)

  for (const branch of input.candidates) {
    if (!state.admitSources(branch, input.signal)) {
      return { kind: 'cancelled' }
    }
  }
  for (const [index, branch] of input.candidates.entries()) {
    const completed = await state.admitExcerpts(
      branch,
      candidateBranchScope(branch.questionId, index),
      input.signal
    )
    if (!completed) {
      return { kind: 'cancelled' }
    }
  }

  if (input.signal.aborted) {
    return { kind: 'cancelled' }
  }

  state.resolveClaims(input.candidates)
  state.resolveNumericLinks(input.candidates)
  state.resolveGaps(input.candidates)
  state.applyFreshness(input.freshness)

  if (!state.hasUsableExcerpt()) {
    return {
      kind: 'failed',
      code: 'insufficient_evidence',
      sources: state.assemble().sources,
      gaps: state.finalizeGaps('no usable evidence excerpt was admitted'),
    }
  }

  return { kind: 'admitted', evidence: state.assemble() }
}

/** Mutable state is owned by one admission pass and never escapes the invocation. */
class EvidenceAdmissionState implements ResolutionState {
  private readonly sources = new Map<string, ResearchSource>()
  readonly sourceIdByUrl = new Map<string, SourceId>()
  private readonly excerpts: EvidenceExcerpt[] = []
  private readonly excerptHashesBySource = new Map<string, Set<string>>()
  private readonly excerptCountsBySource = new Map<string, number>()
  readonly excerptIdByRef = new Map<string, EvidenceExcerptId>()
  readonly claims: ResearchClaim[] = []
  readonly claimIdByRef = new Map<string, ClaimId>()
  readonly numericLinks: NumericEvidenceLink[] = []
  private readonly gaps: EvidenceGap[] = []
  private sourceCounter = 0
  private excerptCounter = 0
  claimCounter = 0

  constructor(
    private readonly bounds: ResearchEvidenceBounds,
    private readonly now: number
  ) {}

  admitSources(branch: ResearchEvidenceBranch, signal: AbortSignal): boolean {
    for (const candidate of branch.sources) {
      if (signal.aborted) {
        return false
      }

      const canonicalUrl = canonicalizeResearchUrl(candidate.url)
      if (canonicalUrl === undefined) {
        this.pushGap({
          code: 'validation',
          message: 'source url is not a canonical https url',
          values: [truncateForGap(candidate.url)],
          reason: 'source_url_not_canonical',
        })
        continue
      }
      if (this.sources.has(canonicalUrl)) {
        continue
      }

      const id = SourceIdSchema.parse(`src-${this.sourceCounter + 1}`)
      const source = buildResearchSource({ candidate, canonicalUrl, id, now: this.now })
      this.sourceCounter += 1
      if (source.safety === 'rejected') {
        this.pushGap({
          code: 'unsafe_content',
          message: 'source metadata failed prompt-injection scan',
          values: [canonicalUrl],
        })
        continue
      }
      this.sources.set(canonicalUrl, source)
      this.sourceIdByUrl.set(canonicalUrl, source.id)
    }
    return true
  }

  async admitExcerpts(
    branch: ResearchEvidenceBranch,
    scope: string,
    signal: AbortSignal
  ): Promise<boolean> {
    for (const candidate of branch.excerpts) {
      if (signal.aborted) {
        return false
      }

      await this.admitExcerpt(scope, candidate, signal)
      if (signal.aborted) {
        return false
      }
    }
    return true
  }

  private async admitExcerpt(
    scope: string,
    candidate: EvidenceExcerptCandidate,
    signal: AbortSignal
  ): Promise<void> {
    const referenceKey = candidateReferenceKey(scope, candidate.ref)
    if (this.excerptIdByRef.has(referenceKey)) {
      this.pushGap({
        code: 'duplicate_reference',
        message: 'duplicate excerpt ref',
        values: [truncateForGap(candidate.ref)],
      })
      return
    }

    const sourceId = this.resolveExcerptSource(candidate)
    if (sourceId === undefined) {
      return
    }

    const rawText = candidate.text.trim()
    const truncated = rawText.length > this.bounds.maxExcerptChars
    const text = truncateAtSentenceBoundary(rawText, this.bounds.maxExcerptChars)
    const derived: DerivedExcerpt = {
      sourceId,
      text,
      textHash: await sha256Hex(normalizeExcerptText(text)),
    }

    if (signal.aborted) {
      return
    }

    if (this.gateExcerpt(derived) !== 'admit') {
      return
    }

    const id = EvidenceExcerptIdSchema.parse(`exc-${this.excerptCounter + 1}`)
    const excerpt: EvidenceExcerpt = {
      id,
      sourceId,
      text: derived.text,
      locator: truncateOnCodePoint(candidate.locator, MAX_LOCATOR_CHARS),
      textHash: derived.textHash,
      retrievedAt: this.now,
      truncated: truncated || candidate.truncated,
      safety: 'admitted',
    }
    this.recordExcerpt(scope, candidate.ref, excerpt)
    if (truncated) {
      this.pushGap({
        code: 'truncation',
        message: 'excerpt truncated to the configured char bound',
        excerptIds: [id],
      })
    }
  }

  private gateExcerpt(derived: DerivedExcerpt): 'admit' | 'skip' {
    const sourceKey = derived.sourceId
    const hashes = this.excerptHashesBySource.get(sourceKey) ?? new Set<string>()
    if (hashes.has(derived.textHash)) {
      return 'skip'
    }

    const count = this.excerptCountsBySource.get(sourceKey) ?? 0
    if (count >= this.bounds.maxExcerptsPerSource) {
      this.pushGap({
        code: 'content_limit',
        message: 'per-source excerpt cap reached',
        sourceIds: [derived.sourceId],
      })
      return 'skip'
    }

    if (classifySafety(derived.text) === 'rejected') {
      this.pushGap({
        code: 'unsafe_content',
        message: 'excerpt failed prompt-injection scan',
        sourceIds: [derived.sourceId],
      })
      return 'skip'
    }
    return 'admit'
  }

  private recordExcerpt(scope: string, ref: string, excerpt: EvidenceExcerpt): void {
    const sourceKey = excerpt.sourceId
    this.excerptCounter += 1
    this.excerpts.push(excerpt)
    this.excerptIdByRef.set(candidateReferenceKey(scope, ref), excerpt.id)
    const hashes = this.excerptHashesBySource.get(sourceKey) ?? new Set<string>()
    hashes.add(excerpt.textHash)
    this.excerptHashesBySource.set(sourceKey, hashes)
    this.excerptCountsBySource.set(sourceKey, (this.excerptCountsBySource.get(sourceKey) ?? 0) + 1)
  }

  private resolveExcerptSource(candidate: EvidenceExcerptCandidate): SourceId | undefined {
    const canonicalUrl = canonicalizeResearchUrl(candidate.sourceRef)
    const key = canonicalUrl ?? candidate.sourceRef
    const sourceId = this.sourceIdByUrl.get(key)
    if (sourceId === undefined) {
      this.pushGap({
        code: 'unresolved_reference',
        message: 'excerpt references an unresolved source',
        values: [truncateForGap(candidate.ref)],
      })
      return undefined
    }
    return sourceId
  }

  resolveClaims(branches: readonly ResearchEvidenceBranch[]): void {
    resolveClaims(this, branches)
  }

  resolveNumericLinks(branches: readonly ResearchEvidenceBranch[]): void {
    resolveNumericLinks(this, branches)
  }

  resolveGaps(branches: readonly ResearchEvidenceBranch[]): void {
    resolveGaps(this, branches)
  }

  applyFreshness(freshness: ResearchFreshness | undefined): void {
    if (freshness === undefined) {
      return
    }
    const filtered = applySourceFreshness({
      sources: [...this.sources.values()],
      excerpts: this.excerpts,
      claims: this.claims,
      numericLinks: this.numericLinks,
      freshness,
    })

    this.sources.clear()
    this.sourceIdByUrl.clear()
    for (const source of filtered.sources) {
      this.sources.set(source.canonicalUrl, source)
      this.sourceIdByUrl.set(source.canonicalUrl, source.id)
    }
    replaceArray(this.excerpts, filtered.excerpts)
    replaceArray(this.claims, filtered.claims)
    replaceArray(this.numericLinks, filtered.numericLinks)
    this.gaps.push(...filtered.gaps)
  }

  assemble(): AdmittedEvidence {
    return {
      sources: [...this.sources.values()],
      excerpts: this.excerpts,
      claims: this.claims,
      numericLinks: this.numericLinks,
      gaps: this.gaps,
      conflicts: [],
    }
  }

  hasUsableExcerpt(): boolean {
    return this.excerpts.length > 0
  }

  finalizeGaps(fallbackMessage: string): readonly EvidenceGap[] {
    if (this.gaps.length > 0) {
      return this.gaps
    }
    return [createGap({ code: 'missing_support', message: fallbackMessage })]
  }

  pushGap(input: CreateGapInput): void {
    this.gaps.push(createGap(input))
  }
}

interface DerivedExcerpt {
  readonly sourceId: SourceId
  readonly text: string
  readonly textHash: string
}

function replaceArray<T>(target: T[], values: readonly T[]): void {
  target.splice(0, target.length, ...values)
}

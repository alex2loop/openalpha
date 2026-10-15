import { z } from 'zod'

import { EXA_SEARCH_TYPES, WEB_SEARCH_PROVIDERS } from '@/core/config/resolve'
import { parseIsoDay } from '@/core/utils/time'

import type { ResearchDirectFetchAttempt, ResearchProviderAttempt } from '../retrieval/retrieval'
import type { EvidenceConflict, EvidenceGap } from './gaps'
import { MAX_EXCERPTS_PER_CLAIM, MAX_QUESTION_CHARS, MAX_RESEARCH_LIST_ITEMS } from '../contracts'

const MAX_HIGHLIGHT_CHARS = 1_000

export type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

const REQUIRED_TEXT = (max: number) => z.string().trim().min(1).max(max)
const boundedText = REQUIRED_TEXT

// Calendar-day string (YYYY-MM-DD). Validates an actual day, not only the shape, by round-tripping
// through the shared parser — Date.parse alone silently rolls impossible days into next month.
// The pipe keeps trim leniency at runtime while emitting format/pattern into the JSON output
// contract (io: 'output' uses the pipe's output side), so schema-enforcing backends cannot emit
// a non-ISO day. parseIsoDay stays the runtime authority for backends that treat it as a hint.
export const IsoDaySchema = z
  .string()
  .trim()
  .pipe(
    z.iso.date().refine((value) => parseIsoDay(value) !== undefined, {
      message: 'expected a calendar day YYYY-MM-DD',
    })
  )
  .describe('calendar day, ISO format YYYY-MM-DD')

// Artifact-local branded IDs. Admission assigns these in deterministic order; candidate refs are
// branch-local hints that admission remaps to canonical IDs (or rejects as validation gaps).
export const SourceIdSchema = z.string().brand<'SourceId'>()
export const EvidenceExcerptIdSchema = z.string().brand<'EvidenceExcerptId'>()
export const ClaimIdSchema = z.string().brand<'ClaimId'>()

export type SourceId = z.infer<typeof SourceIdSchema>
export type EvidenceExcerptId = z.infer<typeof EvidenceExcerptIdSchema>
export type ClaimId = z.infer<typeof ClaimIdSchema>

export const ReportSectionSchema = z.enum([
  'answer',
  'keyEvidence',
  'risks',
  'conflicts',
  'practicalConsiderations',
])
export type ReportSection = z.infer<typeof ReportSectionSchema>
// why-safe: the enum's keys are its members, and `ReportSection` is inferred from that same enum.
export const REPORT_SECTIONS: readonly ReportSection[] = Object.keys(
  ReportSectionSchema.enum
) as readonly ReportSection[]

export const DateProvenanceSchema = z.enum(['provider_estimate', 'extracted_text', 'manual_review'])
export type DateProvenance = z.infer<typeof DateProvenanceSchema>

export const DateConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type DateConfidence = z.infer<typeof DateConfidenceSchema>

// --- Freshness window (requested by the caller, not stored on a source) ---

export interface ResearchFreshness {
  readonly field: 'publishedOn' | 'updatedOn' | 'either'
  readonly fromOn?: string
  readonly toOn?: string
}

const RESEARCH_FRESHNESS_STEM = {
  field: z.enum(['publishedOn', 'updatedOn', 'either']),
}

export const ResearchFreshnessSchema = z.union([
  z.strictObject({ ...RESEARCH_FRESHNESS_STEM, fromOn: IsoDaySchema }),
  z.strictObject({ ...RESEARCH_FRESHNESS_STEM, toOn: IsoDaySchema }),
  z.strictObject({ ...RESEARCH_FRESHNESS_STEM, fromOn: IsoDaySchema, toOn: IsoDaySchema }),
]) satisfies z.ZodType<ResearchFreshness>

export const ResearchSourceKindSchema = z.enum([
  'primary',
  'official',
  'filing',
  'peer_reviewed',
  'reporting',
  'secondary',
])
export type ResearchSourceKind = z.infer<typeof ResearchSourceKindSchema>

export const PRIMARY_SOURCE_KINDS: ReadonlySet<ResearchSourceKind> = new Set([
  'primary',
  'official',
  'filing',
  'peer_reviewed',
])

// --- Provider discovery material (metadata, not evidence itself) ---

const ProviderHighlightSchema = z.strictObject({
  text: boundedText(MAX_HIGHLIGHT_CHARS),
  index: z.number().int().nonnegative(),
  score: z.number().min(0).optional(),
})

export interface ProviderHighlight {
  readonly text: string
  readonly index: number
  readonly score?: number
}

const WebSearchProviderSchema = z.enum(WEB_SEARCH_PROVIDERS)
const ExaSearchTypeSchema = z.enum(EXA_SEARCH_TYPES)

// --- Canonical admitted source ---

export const ResearchSourceDiscoverySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('provider'),
    provider: WebSearchProviderSchema,
    role: z.enum(['default', 'fallback']),
    resultIndex: z.number().int().nonnegative(),
    requestId: boundedText(MAX_QUESTION_CHARS).optional(),
    requestedSearchType: ExaSearchTypeSchema.optional(),
    resolvedSearchType: boundedText(MAX_QUESTION_CHARS).optional(),
    highlights: z.array(ProviderHighlightSchema).max(MAX_EXCERPTS_PER_CLAIM),
    engines: z.array(boundedText(MAX_QUESTION_CHARS)).max(MAX_RESEARCH_LIST_ITEMS),
  }),
  z.strictObject({
    kind: z.literal('direct'),
    origin: z.enum(['request', 'source_link']),
  }),
])

export type ResearchSourceDiscovery = DeepReadonly<z.infer<typeof ResearchSourceDiscoverySchema>>

// Canonical source is readonly on every collection; the Zod schema validates untrusted input.
export interface ResearchSource {
  readonly id: SourceId
  readonly canonicalUrl: string
  readonly title: string
  readonly kind: ResearchSourceKind
  readonly publisher?: string
  readonly owner?: string
  readonly author?: string
  readonly publishedOn?: string
  readonly updatedOn?: string
  readonly dateProvenance?: DateProvenance
  readonly dateConfidence?: DateConfidence
  readonly retrievedAt: number
  readonly discovery: ResearchSourceDiscovery
  readonly safety: 'admitted' | 'rejected'
  readonly availability: 'available' | 'unavailable'
}

// --- Canonical admitted excerpt ---

export interface EvidenceExcerpt {
  readonly id: EvidenceExcerptId
  readonly sourceId: SourceId
  readonly text: string
  readonly locator: string
  readonly textHash: string
  readonly retrievedAt: number
  readonly truncated: boolean
  readonly safety: 'admitted' | 'rejected'
}

// --- Canonical admitted claim ---

export type ResearchClaim =
  | {
      readonly id: ClaimId
      readonly kind: 'factual'
      readonly section: ReportSection
      readonly statement: string
      readonly basis: 'extractive'
      readonly evidenceIds: readonly EvidenceExcerptId[]
      /** The source states an expectation, target or guidance, not something that happened. */
      readonly forecast?: true
    }
  | {
      readonly id: ClaimId
      readonly kind: 'numeric'
      readonly section: ReportSection
      readonly statement: string
      readonly basis: 'extractive'
      readonly evidenceIds: readonly EvidenceExcerptId[]
      readonly number: {
        readonly value: string
        readonly unit: string
        readonly scope: string
        readonly effectiveOn: string
      }
      readonly forecast?: true
    }
  | {
      readonly id: ClaimId
      readonly kind: 'inference'
      readonly section: ReportSection
      readonly statement: string
      readonly basis: 'model_inference'
      readonly evidenceIds: readonly EvidenceExcerptId[]
    }

// --- Numeric evidence link (extractive check) ---

export interface NumericEvidenceLink {
  readonly claimId: ClaimId
  readonly excerptId: EvidenceExcerptId
  readonly valueText: string
  readonly unitText: string
  readonly dateText: string
}

// --- Report: references claim IDs, not embedded findings ---

export interface ResearchReport {
  readonly answer: readonly ClaimId[]
  readonly keyEvidence: readonly ClaimId[]
  readonly risks: readonly ClaimId[]
  readonly conflicts: readonly ClaimId[]
  readonly practicalConsiderations: readonly ClaimId[]
}

export type ResearchRetrievalAttempt = ResearchProviderAttempt | ResearchDirectFetchAttempt

// --- Admitted evidence set ---

export interface AdmittedEvidence {
  readonly sources: readonly ResearchSource[]
  readonly excerpts: readonly EvidenceExcerpt[]
  readonly claims: readonly ResearchClaim[]
  readonly numericLinks: readonly NumericEvidenceLink[]
  readonly gaps: readonly EvidenceGap[]
  readonly conflicts: readonly EvidenceConflict[]
}

export interface ResearchArtifact {
  readonly sources: readonly ResearchSource[]
  readonly excerpts: readonly EvidenceExcerpt[]
  readonly claims: readonly ResearchClaim[]
  readonly numericLinks: readonly NumericEvidenceLink[]
  readonly gaps: readonly EvidenceGap[]
  readonly conflicts: readonly EvidenceConflict[]
  readonly report: ResearchReport
  readonly retrievalAttempts: readonly ResearchRetrievalAttempt[]
}

export function hasAnswerClaim(claims: readonly { readonly section: ReportSection }[]): boolean {
  return claims.some((claim) => claim.section === 'answer')
}

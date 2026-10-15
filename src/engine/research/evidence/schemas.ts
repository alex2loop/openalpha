import { z } from 'zod'

import { MAX_RESEARCH_QUESTIONS_LIMIT } from '@/core/config/resolve'

import type { ResearchObjective } from '../planning/profile'
import type { DeepReadonly, ReportSection } from './model'
import {
  MAX_CANONICAL_URL_CHARS,
  MAX_CLAIM_CHARS,
  MAX_CLAIMS_PER_BRANCH,
  MAX_CONFLICTS,
  MAX_EVIDENCE_CHARS,
  MAX_EVIDENCE_REFS_PER_CLAIM,
  MAX_EXCERPTS_PER_BRANCH,
  MAX_GAP_CHARS,
  MAX_GAP_VALUE_ITEM_CHARS,
  MAX_GAP_VALUE_ITEMS,
  MAX_GAPS,
  MAX_KEY_EVIDENCE,
  MAX_LOCATOR_CHARS,
  MAX_NUMERIC_LINKS,
  MAX_NUMERIC_SCOPE_CHARS,
  MAX_NUMERIC_SPAN_CHARS,
  MAX_NUMERIC_UNIT_CHARS,
  MAX_NUMERIC_VALUE_CHARS,
  MAX_OBJECTIVE_CHARS,
  MAX_PRACTICAL_CONSIDERATIONS,
  MAX_QUESTION_CHARS,
  MAX_QUOTES_PER_CLAIM_SOURCE,
  MAX_REPORT_CLAIM_IDS,
  MAX_RESEARCH_LIST_ITEMS,
  MAX_REVIEW_ISSUES,
  MAX_RISKS,
  MAX_SOURCE_KIND_CHARS,
  MAX_SOURCES_PER_BRANCH,
  MAX_SOURCES_PER_CLAIM,
  RESEARCH_QUERY_MAX_CHARS,
  REVIEW_DIMENSIONS,
  type ResearchReview,
} from '../contracts'
import { EvidenceCandidateGapCodeSchema } from './gaps'
import {
  ClaimIdSchema,
  DateConfidenceSchema,
  DateProvenanceSchema,
  hasAnswerClaim,
  IsoDaySchema,
  ReportSectionSchema,
  ResearchFreshnessSchema,
  ResearchSourceDiscoverySchema,
  ResearchSourceKindSchema,
} from './model'
import { decodeResearchPayload } from './parse'

const REQUIRED_TEXT = (max: number) => z.string().trim().min(1).max(max)

// The wire contract strips these array bounds (ai/adapters/openai/strict-schema), so the
// synthesis prompt renders them as the model's only notice of them.
export const REPORT_SECTION_LIMITS = {
  answer: MAX_KEY_EVIDENCE,
  keyEvidence: MAX_KEY_EVIDENCE,
  risks: MAX_RISKS,
  conflicts: MAX_CONFLICTS,
  practicalConsiderations: MAX_PRACTICAL_CONSIDERATIONS,
} as const satisfies Record<ReportSection, number>
const RESEARCH_REVIEW_ISSUE_STEM = {
  dimension: z.enum(REVIEW_DIMENSIONS),
  description: REQUIRED_TEXT(MAX_GAP_CHARS),
  claimIds: z.array(ClaimIdSchema).max(MAX_REPORT_CLAIM_IDS),
  questionIds: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).max(MAX_RESEARCH_QUESTIONS_LIMIT),
}
const RESEARCH_SOURCE_GUIDANCE = z
  .array(REQUIRED_TEXT(MAX_SOURCE_KIND_CHARS))
  .max(MAX_RESEARCH_LIST_ITEMS)

const ResearchReviewIssueSchema = z.discriminatedUnion('requiresResearch', [
  z.strictObject({
    ...RESEARCH_REVIEW_ISSUE_STEM,
    requiresResearch: z.literal(true),
    followUpQuery: REQUIRED_TEXT(MAX_QUESTION_CHARS),
    sourceGuidance: RESEARCH_SOURCE_GUIDANCE.optional(),
  }),
  z.strictObject({
    ...RESEARCH_REVIEW_ISSUE_STEM,
    requiresResearch: z.literal(false),
  }),
])

const ResearchQuestionSchema = z.strictObject({
  id: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  question: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  objective: REQUIRED_TEXT(MAX_OBJECTIVE_CHARS),
  searchTerms: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).min(1).max(MAX_RESEARCH_LIST_ITEMS),
  preferredSourceKinds: z
    .array(REQUIRED_TEXT(MAX_SOURCE_KIND_CHARS))
    .min(1)
    .max(MAX_RESEARCH_LIST_ITEMS),
})

const RESEARCH_OBJECTIVE_STEM = {
  original: REQUIRED_TEXT(RESEARCH_QUERY_MAX_CHARS),
  normalized: REQUIRED_TEXT(RESEARCH_QUERY_MAX_CHARS),
  dimensions: z.array(REQUIRED_TEXT(MAX_OBJECTIVE_CHARS)).min(1).max(MAX_RESEARCH_QUESTIONS_LIMIT),
  assumptions: z.array(REQUIRED_TEXT(MAX_OBJECTIVE_CHARS)).max(MAX_RESEARCH_LIST_ITEMS),
  complexity: z.enum(['simple', 'standard', 'complex']),
}

const ResearchObjectiveSchema = z.union([
  z.strictObject(RESEARCH_OBJECTIVE_STEM),
  z.strictObject({ ...RESEARCH_OBJECTIVE_STEM, freshness: ResearchFreshnessSchema }),
]) satisfies z.ZodType<ResearchObjective>

const ResearchConstraintCoverageSchema = z.strictObject({
  constraint: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  questionIds: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).min(1),
})

export const ResearchPlanSchema = z
  .strictObject({
    objective: ResearchObjectiveSchema,
    questions: z.array(ResearchQuestionSchema).min(1).max(MAX_RESEARCH_QUESTIONS_LIMIT),
    coverage: z.array(ResearchConstraintCoverageSchema).min(1),
  })
  .refine(
    (plan) => {
      const ids = new Set(plan.questions.map((q) => q.id))
      const uniqueIds = ids.size === plan.questions.length
      const coverageValid = plan.coverage.every((c) => c.questionIds.every((id) => ids.has(id)))
      const allCovered = plan.questions.every((q) =>
        plan.coverage.some((c) => c.questionIds.includes(q.id))
      )
      return uniqueIds && coverageValid && allCovered
    },
    { message: 'invalid plan structure' }
  )

export type ResearchPlan = DeepReadonly<z.infer<typeof ResearchPlanSchema>>
export type ResearchQuestion = DeepReadonly<z.infer<typeof ResearchQuestionSchema>>

const ResearchSourceCandidateSchema = z
  .strictObject({
    url: z.string().trim().min(1).max(MAX_CANONICAL_URL_CHARS),
    title: REQUIRED_TEXT(MAX_CLAIM_CHARS),
    kind: ResearchSourceKindSchema,
    publisher: REQUIRED_TEXT(MAX_CLAIM_CHARS).optional(),
    owner: REQUIRED_TEXT(MAX_CLAIM_CHARS).optional(),
    author: REQUIRED_TEXT(MAX_CLAIM_CHARS).optional(),
    publishedOn: IsoDaySchema.optional(),
    updatedOn: IsoDaySchema.optional(),
    dateProvenance: DateProvenanceSchema.optional(),
    dateConfidence: DateConfidenceSchema.optional(),
    discovery: ResearchSourceDiscoverySchema,
  })
  .refine(
    (source) => {
      const hasDate = source.publishedOn !== undefined || source.updatedOn !== undefined
      const hasClassification =
        source.dateProvenance !== undefined && source.dateConfidence !== undefined
      return hasDate === hasClassification
    },
    { message: 'source date requires provenance and confidence' }
  )

const EvidenceExcerptCandidateSchema = z.strictObject({
  ref: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  sourceRef: REQUIRED_TEXT(MAX_CANONICAL_URL_CHARS),
  text: REQUIRED_TEXT(MAX_EVIDENCE_CHARS),
  locator: REQUIRED_TEXT(MAX_LOCATOR_CHARS),
  truncated: z.boolean(),
})

// An expectation, projection, target or guidance its source states, as opposed to an outcome.
const ForecastFlagSchema = z
  .boolean()
  .optional()
  .describe('true when the source states an expectation, projection, target, or guidance')

const ResearchClaimCandidateStem = {
  ref: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  section: ReportSectionSchema,
  statement: REQUIRED_TEXT(MAX_CLAIM_CHARS),
  evidenceRefs: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).min(1).max(MAX_EVIDENCE_REFS_PER_CLAIM),
}

const NumericClaimValueSchema = z.strictObject({
  value: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NUMERIC_VALUE_CHARS)
    .regex(/^[+-]?\d+(\.\d+)?$/, 'numeric value must be a canonical decimal'),
  unit: REQUIRED_TEXT(MAX_NUMERIC_UNIT_CHARS),
  scope: REQUIRED_TEXT(MAX_NUMERIC_SCOPE_CHARS),
  effectiveOn: IsoDaySchema,
})

const ResearchClaimCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('factual'),
    basis: z.literal('extractive'),
    ...ResearchClaimCandidateStem,
    forecast: ForecastFlagSchema,
  }),
  z.strictObject({
    kind: z.literal('numeric'),
    basis: z.literal('extractive'),
    ...ResearchClaimCandidateStem,
    number: NumericClaimValueSchema,
    forecast: ForecastFlagSchema,
  }),
  z.strictObject({
    kind: z.literal('inference'),
    basis: z.literal('model_inference'),
    ...ResearchClaimCandidateStem,
  }),
])

const NumericEvidenceLinkCandidateSchema = z.strictObject({
  claimRef: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  excerptRef: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  valueText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS),
  unitText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS),
  dateText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS),
})

const FlatNumericSpansSchema = z.strictObject({
  valueText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS),
  unitText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS),
  dateText: REQUIRED_TEXT(MAX_NUMERIC_SPAN_CHARS)
    .optional()
    .describe('verbatim date span copied from this source; omit when the source shows no date'),
})

const FlatBranchSourceStem = {
  url: z.string().trim().min(1).max(MAX_CANONICAL_URL_CHARS),
  kind: ResearchSourceKindSchema.optional(),
  publisher: REQUIRED_TEXT(MAX_CLAIM_CHARS).optional(),
  owner: REQUIRED_TEXT(MAX_CLAIM_CHARS).optional(),
  quotes: z.array(REQUIRED_TEXT(MAX_EVIDENCE_CHARS)).min(1).max(MAX_QUOTES_PER_CLAIM_SOURCE),
}

const FlatBranchSourceSchema = z.strictObject(FlatBranchSourceStem)
const FlatNumericBranchSourceSchema = z.strictObject({
  ...FlatBranchSourceStem,
  numericSpans: FlatNumericSpansSchema,
})

const FlatBranchClaimBase = {
  section: ReportSectionSchema,
  statement: REQUIRED_TEXT(MAX_CLAIM_CHARS),
}

const FlatBranchClaimStem = {
  ...FlatBranchClaimBase,
  sources: z.array(FlatBranchSourceSchema).min(1).max(MAX_SOURCES_PER_CLAIM),
}

const FlatNumericBranchClaimStem = {
  ...FlatBranchClaimBase,
  sources: z.array(FlatNumericBranchSourceSchema).min(1).max(MAX_SOURCES_PER_CLAIM),
}

const FlatBranchClaimSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('factual'),
    ...FlatBranchClaimStem,
    forecast: ForecastFlagSchema,
  }),
  z.strictObject({
    kind: z.literal('numeric'),
    ...FlatNumericBranchClaimStem,
    number: NumericClaimValueSchema,
    forecast: ForecastFlagSchema,
  }),
  z.strictObject({
    kind: z.literal('inference'),
    ...FlatBranchClaimStem,
  }),
])

export const FLAT_BRANCH_GAP_CODES = ['missing_support'] as const

const FlatBranchGapSchema = z.strictObject({
  code: z.enum(FLAT_BRANCH_GAP_CODES),
  message: REQUIRED_TEXT(MAX_GAP_CHARS),
  values: z.array(REQUIRED_TEXT(MAX_GAP_VALUE_ITEM_CHARS)).max(MAX_GAP_VALUE_ITEMS).optional(),
})

export const FlatResearchBranchSchema = z
  .strictObject({
    claims: z.array(FlatBranchClaimSchema).max(MAX_CLAIMS_PER_BRANCH),
    gaps: z.array(FlatBranchGapSchema).max(MAX_GAPS),
  })
  .refine((branch) => branch.claims.length === 0 || hasAnswerClaim(branch.claims), {
    message: 'non-empty branch requires an answer claim',
    path: ['claims'],
  })

export type FlatResearchBranch = DeepReadonly<z.infer<typeof FlatResearchBranchSchema>>

const FlatBranchEnvelopeSchema = z.object({
  claims: z.array(z.unknown()),
  gaps: z.array(z.unknown()).optional(),
})

const EvidenceGapCandidateSchema = z.strictObject({
  code: EvidenceCandidateGapCodeSchema,
  claimRefs: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).max(MAX_REPORT_CLAIM_IDS),
  excerptRefs: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).max(MAX_REPORT_CLAIM_IDS),
  sourceRefs: z.array(REQUIRED_TEXT(MAX_QUESTION_CHARS)).max(MAX_REPORT_CLAIM_IDS),
  values: z.array(REQUIRED_TEXT(MAX_GAP_VALUE_ITEM_CHARS)).max(MAX_GAP_VALUE_ITEMS),
  params: z.strictObject({ reason: REQUIRED_TEXT(MAX_GAP_CHARS).optional() }).optional(),
  message: REQUIRED_TEXT(MAX_GAP_CHARS),
})

export type ResearchSourceCandidate = DeepReadonly<z.infer<typeof ResearchSourceCandidateSchema>>
export type EvidenceExcerptCandidate = DeepReadonly<z.infer<typeof EvidenceExcerptCandidateSchema>>
export type ResearchClaimCandidate = DeepReadonly<z.infer<typeof ResearchClaimCandidateSchema>>
export type NumericEvidenceLinkCandidate = DeepReadonly<
  z.infer<typeof NumericEvidenceLinkCandidateSchema>
>
export type EvidenceGapCandidate = DeepReadonly<z.infer<typeof EvidenceGapCandidateSchema>>

const ResearchEvidenceBranchSchema = z.strictObject({
  questionId: REQUIRED_TEXT(MAX_QUESTION_CHARS),
  sources: z.array(ResearchSourceCandidateSchema).max(MAX_SOURCES_PER_BRANCH),
  excerpts: z.array(EvidenceExcerptCandidateSchema).max(MAX_EXCERPTS_PER_BRANCH),
  claims: z.array(ResearchClaimCandidateSchema).max(MAX_CLAIMS_PER_BRANCH),
  numericLinks: z.array(NumericEvidenceLinkCandidateSchema).max(MAX_NUMERIC_LINKS),
  gaps: z.array(EvidenceGapCandidateSchema).max(MAX_GAPS),
})

export type ResearchEvidenceBranch = DeepReadonly<z.infer<typeof ResearchEvidenceBranchSchema>>

// Backends without strict structured output sometimes stringify array scalars; coerce before the
// int/range checks so a quoted "3" validates while "clm-3" still fails. The widening is Number()
// semantics verbatim: true→1 and hex/exponent strings coerce too — accepted, range-bounded.
const REPORT_POSITION = z.coerce.number().int().positive().max(MAX_REPORT_CLAIM_IDS)

export const ResearchReportCandidateSchema = z.strictObject({
  answer: z.array(REPORT_POSITION).min(1).max(MAX_KEY_EVIDENCE),
  keyEvidence: z.array(REPORT_POSITION).max(MAX_KEY_EVIDENCE),
  risks: z.array(REPORT_POSITION).max(MAX_RISKS),
  conflicts: z.array(REPORT_POSITION).max(MAX_CONFLICTS),
  practicalConsiderations: z.array(REPORT_POSITION).max(MAX_PRACTICAL_CONSIDERATIONS),
})

// Candidate report: the synthesizer picks per-section positions (1-based) into the section's claim
// list. Admission owns the canonical claim ids; positions never leave this candidate shape.
export type ResearchReportCandidate = DeepReadonly<z.infer<typeof ResearchReportCandidateSchema>>

export const ResearchReviewSchema = z
  .strictObject({
    verdict: z.enum(['approve', 'revise']),
    scores: z.strictObject({
      factualSupport: z.number().min(0).max(1),
      citationAccuracy: z.number().min(0).max(1),
      completeness: z.number().min(0).max(1),
      sourceQuality: z.number().min(0).max(1),
      relevance: z.number().min(0).max(1),
      clarity: z.number().min(0).max(1),
    }),
    // A research issue costs a follow-up crawl, so its list is a spend ceiling. Naming an
    // unsupported claim costs nothing, and a rejection list that runs out ships the overflow.
    unsupportedClaimIds: z.array(ClaimIdSchema).max(MAX_REPORT_CLAIM_IDS),
    // Neutral verdicts are kept and labeled, never deleted, so they need no repair issue and
    // never block approval (verifier false negatives are the common case, not the rare one).
    unverifiedClaimIds: z.array(ClaimIdSchema).max(MAX_REPORT_CLAIM_IDS),
    issues: z.array(ResearchReviewIssueSchema).max(MAX_REVIEW_ISSUES),
  })
  .refine(
    (review) =>
      review.verdict !== 'revise' ||
      review.issues.some((issue) => issue.claimIds.length > 0 || issue.questionIds.length > 0),
    { message: 'revise verdict requires an actionable issue' }
  )
  // computeReviewVerdict treats any issue as revise-worthy; forbid approve+issues at the
  // schema so the model resolves the contradiction in the correction retry, not silently here.
  .refine((review) => review.verdict !== 'approve' || review.issues.length === 0, {
    message: 'approve verdict must not carry issues',
  })
  .refine(
    (review) =>
      review.unsupportedClaimIds.length === 0 ||
      (review.verdict === 'revise' &&
        review.unsupportedClaimIds.every((claimId) =>
          review.issues.some((issue) => issue.claimIds.includes(claimId))
        )),
    { message: 'every semantically unsupported claim requires a named revision issue' }
  ) satisfies z.ZodType<ResearchReview>

// One malformed claim must not discard the whole crawl payload: keep per-item-valid claims and
// gaps, accept only if the pruned branch passes the full schema; undefined when nothing was
// pruned or the pruned branch is still invalid (caller falls back to the invalid-output path).
export function salvageFlatBranch(
  raw: string
): { readonly value: FlatResearchBranch; readonly dropped: number } | undefined {
  const decoded = decodeResearchPayload(raw)
  if (decoded.kind === 'invalid') {
    return undefined
  }

  const envelope = FlatBranchEnvelopeSchema.safeParse(decoded.value)
  if (!envelope.success) {
    return undefined
  }

  const rawClaims = envelope.data.claims
  const rawGaps = envelope.data.gaps ?? []
  const claims = keepValid(FlatBranchClaimSchema, rawClaims)
  const gaps = keepValid(FlatBranchGapSchema, rawGaps)
  const dropped = rawClaims.length - claims.length + (rawGaps.length - gaps.length)

  // Keeping none of the claims the model sent is total loss, not salvage. Reporting it as an empty
  // branch turns a malformed reply into "no claims found", and the retry then asks the model to
  // find claims instead of naming what its claims got wrong.
  if (dropped === 0 || (rawClaims.length > 0 && claims.length === 0)) {
    return undefined
  }

  const branch = FlatResearchBranchSchema.safeParse({ claims, gaps })
  return branch.success ? { value: branch.data, dropped } : undefined
}

function keepValid<T>(schema: z.ZodType<T>, values: readonly unknown[]): T[] {
  const kept: T[] = []
  for (const value of values) {
    const parsed = schema.safeParse(value)
    if (parsed.success) {
      kept.push(parsed.data)
    }
  }
  return kept
}

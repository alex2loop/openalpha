import { z } from 'zod'

import type { SuggestionCitation } from '@/trading/features/suggestion/citation'
import type {
  AnalystCase,
  ClaimVerification,
  ResearchCase,
  RiskDecision,
} from '@/trading/features/suggestion/debate/types'
import {
  CLAIM_VERDICTS,
  MANAGER_VERDICTS,
  RESEARCH_STANCES,
  RISK_VERDICTS,
  SIZING_INTENTS,
  TRADE_STANCES,
} from '@/trading/features/suggestion/debate/types'
import { CONVICTION_BANDS } from '@/trading/kernel/conviction'

// The wire shapes every persona is held to: a role cannot return a level, a size, or a conviction
// the deterministic pipeline did not compute, because there is nowhere here to put one.

const MAXIMUM_TEXT_CHARS = 2_000
/** A claim is one assertion the evidence can confirm or contradict. The cap is the structural half
 *  of that: a paragraph admits a hedge, and a hedge cannot be verified either way. */
export const MAXIMUM_CLAIM_CHARS = 240
/** Ids are minted by the pipeline (`bull-1`); the cap only bounds what a role may echo back. */
const MAXIMUM_CLAIM_ID_CHARS = 32
export const MAXIMUM_CLAIMS = 12
/** Fewer than the claim cap on purpose: an invalidator is what the operator is asked to watch for,
 *  and a list longer than this is not watched. */
export const MAXIMUM_INVALIDATORS = 4
/** A reviewing role is handed every researcher's list at once, so its selection is bounded by the
 *  sum, not by one role's cap. The verifier must return a verdict per claim, so a tighter bound
 *  would make obeying its own instruction a schema violation. */
const MAXIMUM_REVIEWED_CLAIMS = MAXIMUM_CLAIMS * 2
/** The verifier is handed the prior call's conditions beside the claims and told to verdict every
 *  one of them, so its answer is bounded by both caps. Sized on the claims alone, a correct answer
 *  on a name with a previous thesis overran the schema — and the repair re-ask could not clear it,
 *  since obeying the bound meant dropping a verdict the prompt demands. */
const MAXIMUM_VERIFIED_ENTRIES = MAXIMUM_REVIEWED_CLAIMS + MAXIMUM_INVALIDATORS
const MAXIMUM_CITATIONS = 12
/** A persona handed an array slot still sometimes writes the list marker it would have used in
 *  prose. The marker is not part of the assertion, so it is stripped once here rather than by every
 *  reader. Dashes are deliberately not in the set: a claim may open on a negative number, and
 *  stripping that sign would restate the assertion as its opposite. */
const LIST_MARKER_RE = /^[\s.*•]+/

const text = z.string().min(1).max(MAXIMUM_TEXT_CHARS)
const claimText = z
  .string()
  .min(1)
  .max(MAXIMUM_CLAIM_CHARS)
  .transform((claim) => claim.replace(LIST_MARKER_RE, '').trimEnd())
  .pipe(z.string().min(1))
const claimId = z.string().min(1).max(MAXIMUM_CLAIM_ID_CHARS)
const probability = z.number().min(0).max(1)

/** Title and date are accepted because a persona attaches them unasked, and dropped by
 *  `toCitation` because it authors them: the evidence the URL resolves to carries the real ones. */
const CITATION_SCHEMA = z.strictObject({
  url: z.url(),
  title: z.string().max(MAXIMUM_TEXT_CHARS).optional(),
  publishedAt: z.number().int().positive().optional(),
})

const RESEARCH_CASE_SCHEMA = z.strictObject({
  stance: z.enum(RESEARCH_STANCES),
  summary: text,
  // Past the cap the first claims are kept rather than failing the whole case.
  claims: z
    .array(claimText)
    .min(1)
    .transform((claims) => claims.slice(0, MAXIMUM_CLAIMS))
    .pipe(z.array(z.string()).min(1)),
  citations: z.array(CITATION_SCHEMA).max(MAXIMUM_CITATIONS),
})

/** A researcher argues its side or reports that it cannot; the opposite stance is the one answer
 *  it must not give. `claims.ts` stamps every claim with its case's stance and filters on
 *  it, so a case that crossed sides would be counted as support for the side it was meant to test. */
export const BULL_CASE_SCHEMA = RESEARCH_CASE_SCHEMA.extend({
  stance: z.enum(['bullish', 'neutral']),
})
export const BEAR_CASE_SCHEMA = RESEARCH_CASE_SCHEMA.extend({
  stance: z.enum(['bearish', 'neutral']),
})

/** Lean's analyst is researcher and synthesizer at once, so it declares its own material set —
 *  the lean counterpart of `acceptedClaims` below, by 1-based position because it writes the claims
 *  and the selection in one answer. Only these are verified, and only these can hold the run. */
export const ANALYST_CASE_SCHEMA = RESEARCH_CASE_SCHEMA.extend({
  // Positions past the kept claims are dropped rather than failing the answer.
  materialClaims: z
    .array(z.int().positive())
    .transform((positions) => positions.filter((position) => position <= MAXIMUM_CLAIMS))
    .pipe(z.array(z.int().positive())),
  invalidators: z.array(claimText).max(MAXIMUM_INVALIDATORS),
  probability,
})

export const PORTFOLIO_MANAGER_SCHEMA = z.strictObject({
  verdict: z.enum(MANAGER_VERDICTS),
  rationale: text,
  acceptedClaims: z.array(claimId).max(MAXIMUM_REVIEWED_CLAIMS),
  rejectedClaims: z.array(claimId).max(MAXIMUM_REVIEWED_CLAIMS),
  invalidators: z.array(claimText).max(MAXIMUM_INVALIDATORS),
})

/** A price crossing carries its level as the board quotes it, so the pipeline can check it against
 *  the price already trading rather than trust the role's reading of the tape. */
const entryConditionSchema = z.strictObject({
  text,
  // Free text read by `toTradePlan`: a persona held to one literal fails the whole plan instead of
  // leaving the condition gating.
  kind: z.string().nullish(),
  above: z.number().finite().positive().nullish(),
  below: z.number().finite().positive().nullish(),
})

export const TRADE_PLAN_SCHEMA = z.strictObject({
  stance: z.enum(TRADE_STANCES),
  entryTiming: text,
  entryConditions: z.array(entryConditionSchema).max(MAXIMUM_CLAIMS),
  sizingIntent: z.enum(SIZING_INTENTS),
  notes: z.array(text).max(MAXIMUM_CLAIMS),
})

export const RISK_DECISION_SCHEMA = z.strictObject({
  verdict: z.enum(RISK_VERDICTS),
  conviction: z.enum(CONVICTION_BANDS).optional(),
  notes: z.array(text).max(MAXIMUM_CLAIMS),
  probability,
})

export const CLAIM_VERIFICATION_SCHEMA = z.strictObject({
  verified: z
    .array(
      z.strictObject({
        id: claimId,
        verdict: z.enum(CLAIM_VERDICTS),
        citation: CITATION_SCHEMA.optional(),
      })
    )
    .max(MAXIMUM_VERIFIED_ENTRIES),
})

// Zod renders an optional field as `T | undefined`, which `exactOptionalPropertyTypes` refuses to
// assign to a domain `field?: T`. These normalizers drop the absent keys instead of widening the
// domain types — the schemas themselves stay plain objects so `toResearchOutputContract` can still
// derive a strict JSON schema from them.

function toCitation(raw: z.infer<typeof CITATION_SCHEMA>): SuggestionCitation {
  return { url: raw.url }
}

export function toResearchCase(raw: z.infer<typeof RESEARCH_CASE_SCHEMA>): ResearchCase {
  return { ...raw, citations: raw.citations.map(toCitation) }
}

export function toAnalystCase(raw: z.infer<typeof ANALYST_CASE_SCHEMA>): AnalystCase {
  return { ...raw, citations: raw.citations.map(toCitation) }
}

export function toRiskDecision(raw: z.infer<typeof RISK_DECISION_SCHEMA>): RiskDecision {
  return {
    verdict: raw.verdict,
    notes: raw.notes,
    probability: raw.probability,
    ...(raw.conviction === undefined ? {} : { conviction: raw.conviction }),
  }
}

export function toClaimVerification(
  raw: z.infer<typeof CLAIM_VERIFICATION_SCHEMA>
): ClaimVerification {
  return {
    verified: raw.verified.map((entry) => ({
      id: entry.id,
      verdict: entry.verdict,
      ...(entry.citation === undefined ? {} : { citation: toCitation(entry.citation) }),
    })),
  }
}

import type { ReasoningMode } from '@/core/llm'

export const RESEARCH_DEPTHS = ['light', 'medium', 'deep'] as const
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number]

export const RESEARCH_PROFILE_DEPTHS = Object.freeze({
  quick: 'light',
  standard: 'medium',
  thorough: 'deep',
} as const satisfies Readonly<Record<string, ResearchDepth>>)

export const MAX_RESEARCH_QUESTIONS_LIMIT = 7
const MAX_RESEARCH_SUBQUERIES_LIMIT = 42

const DEFAULT_RESEARCH_MAX_QUESTIONS = 7
const DEFAULT_RESEARCH_MAX_SEARCH_TERMS_PER_QUESTION = 3
const DEFAULT_RESEARCH_REVIEW_ROUNDS = 2
const DEFAULT_RESEARCH_REVIEW_THRESHOLD = 0.7
const DEFAULT_MAX_EXCERPT_CHARS = 4_000
const DEFAULT_MAX_EXCERPTS_PER_SOURCE = 8
// Enough for a claim to stand on more than one source without a paid review round, while a crawl
// stays at about three excerpt-sized reads.
const DEFAULT_MAX_DIRECT_PAGES_PER_QUESTION = 3
// Sized for a run whose review rounds actually retrieve: three follow-up crawls roughly double the
// evidence, and at half this the trim discarded the claims those crawls were paid for.
const DEFAULT_MAX_ARTIFACT_BYTES = 128 * 1_024 // 128 KiB
const DEFAULT_MAX_FULL_TEXT_BYTES_PER_SOURCE = 64 * 1_024 // 64 KiB

// Per-stage reasoning + max_tokens. max_tokens floors are documented necessity, not
// tuning: thinking tokens count toward max_tokens, so a stage must clear its full effort budget
// (low 1,024 / medium 4,096 — ai/reasoning.ts) plus answer room, or the provider truncates the
// reply at finish=length before any answer tokens exist.
const DEFAULT_RESEARCH_STAGES = {
  planner: { reasoning: 'medium', maxTokens: 6000 },
  // Crawler answers are verbatim quotes: answer room scales with how densely the source
  // language tokenizes, and Vietnamese costs several times English at equal meaning. An adaptive
  // model does not hold `low` to its 1,024 budget: Claude Haiku 5.5 spent 4,200-4,500 thinking
  // tokens on eight Vietnamese pages, which left a 6,000 cap no room for the answer.
  crawler: { reasoning: 'low', maxTokens: 12000 },
  // A revision pass re-emits the whole report with the reviewer's corrections on top: the
  // pipeline's longest answer.
  synthesizer: { reasoning: 'low', maxTokens: 6000 },
  reviewer: { reasoning: 'medium', maxTokens: 6000 },
} as const

export type ResearchStageId = keyof typeof DEFAULT_RESEARCH_STAGES

interface ResolvedResearchStage {
  readonly reasoning: ReasoningMode
  readonly maxTokens: number
}

export interface ResolvedResearch {
  readonly maxQuestions: number
  readonly maxSearchTermsPerQuestion: number
  readonly maxSubqueries: number
  readonly maxReviewRounds: number
  readonly reviewThreshold: number
  readonly maxExcerptChars: number
  readonly maxExcerptsPerSource: number
  readonly maxArtifactBytes: number
  /** Pages a question reads itself when its search provider returns no page text. */
  readonly maxDirectPagesPerQuestion: number
  readonly maxFullTextBytesPerSource: number
  readonly stages: Readonly<Record<ResearchStageId, ResolvedResearchStage>>
}

// Fixed policy, not operator tuning: the bounds above were sized against measured runs.
export const RESEARCH_LIMITS: ResolvedResearch = Object.freeze({
  maxQuestions: DEFAULT_RESEARCH_MAX_QUESTIONS,
  maxSearchTermsPerQuestion: DEFAULT_RESEARCH_MAX_SEARCH_TERMS_PER_QUESTION,
  maxSubqueries: Math.min(
    MAX_RESEARCH_SUBQUERIES_LIMIT,
    DEFAULT_RESEARCH_MAX_QUESTIONS *
      DEFAULT_RESEARCH_MAX_SEARCH_TERMS_PER_QUESTION *
      (DEFAULT_RESEARCH_REVIEW_ROUNDS + 1)
  ),
  maxReviewRounds: DEFAULT_RESEARCH_REVIEW_ROUNDS,
  reviewThreshold: DEFAULT_RESEARCH_REVIEW_THRESHOLD,
  maxExcerptChars: DEFAULT_MAX_EXCERPT_CHARS,
  maxExcerptsPerSource: DEFAULT_MAX_EXCERPTS_PER_SOURCE,
  maxArtifactBytes: DEFAULT_MAX_ARTIFACT_BYTES,
  maxDirectPagesPerQuestion: DEFAULT_MAX_DIRECT_PAGES_PER_QUESTION,
  maxFullTextBytesPerSource: DEFAULT_MAX_FULL_TEXT_BYTES_PER_SOURCE,
  stages: DEFAULT_RESEARCH_STAGES,
})

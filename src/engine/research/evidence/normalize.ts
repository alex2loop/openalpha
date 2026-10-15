import { scanOutput } from '@/core/security/sanitize'
import { hasElidedMiddle } from '@/core/utils/text'
import { parseIsoDay } from '@/core/utils/time'

import type { ResearchFreshness, ResearchSource } from './model'

// Canonicalization, normalization, safety classification, and truncation. Pure helpers with no
// admission-state dependency; admission calls them in deterministic order.

const MAX_GAP_VALUE_CHARS = 200
const TRUNCATION_MARKER = '…'
const WHITESPACE_RUN_RE = /\s+/g
const CODE_SPAN_RE = /```[\s\S]*?```|`[^`\n]*`/g
const SENTENCE_END_RE = /[.!?…](?=\s)|[。！？]|\n/g
const MIN_SENTENCE_CUT_RATIO = 0.5
const SURROUNDING_QUOTES_RE = /^["'“”‘’«»‹›`]+|["'“”‘’«»‹›`]+$/g
const TRAILING_PUNCTUATION_RE = /[.,;:!?]+$/
const INNER_SINGLE_QUOTES_RE = /[‘’‚‛]/g
const INNER_DOUBLE_QUOTES_RE = /[“”„‟«»‹›]/g
const DASHES_RE = /[‐‑‒–—―]/g
const MISMATCH_CONTEXT_CHARS = 80
// Below this token-overlap floor a failed quote matches no real passage and is treated as invented.
const MIN_REANCHOR_TOKEN_OVERLAP = 0.6
const PARAGRAPH_SPLIT_RE = /\n{2,}/
const CLAIM_KEY_NON_WORD_RE = /[^\p{L}\p{N}]+/gu
const CLAIM_KEY_NORMALIZATION_FORM = 'NFKC'
const DIGIT_RE = /\d/
const DECIMAL_SEPARATOR_RE = /[.,]/

/** Debug record for a quote that failed containment: how far it matched, and where it stopped. */
interface NormalizedMismatch {
  readonly matchedChars: number
  readonly quoteChars: number
  readonly divergedAt: string
}

/** Why a quote is missing from a source's fetched content, most conclusive first. */
type QuoteOrigin = 'snippet' | 'elided_content' | 'absent'

interface QuoteOriginInput {
  readonly quote: string
  readonly snippet: string
  readonly content: string
}

/** Word-identity key text: encoding-folded, case-folded, punctuation collapsed to spaces. */
export function normalizeClaimKeyText(value: string): string {
  return value
    .normalize(CLAIM_KEY_NORMALIZATION_FORM)
    .toLowerCase()
    .replace(CLAIM_KEY_NON_WORD_RE, ' ')
    .trim()
}

/** Collapse runs of whitespace without rewriting code spans, numbers, or URLs (whitespace only). */
export function normalizeExcerptText(text: string): string {
  let normalized = ''
  let cursor = 0

  for (const match of text.matchAll(CODE_SPAN_RE)) {
    const index = match.index
    normalized += normalizeProse(text.slice(cursor, index))
    normalized += match[0]
    cursor = index + match[0].length
  }
  normalized += normalizeProse(text.slice(cursor))
  return normalized.trim()
}

// Matcher-only normalization (never used for stored/displayed text): encoding-canonicalizes
// (NFC, so composed and decomposed Vietnamese diacritics compare equal), folds typographic
// quotes/dashes to their ASCII equivalents, case-folds, and strips one layer of surrounding
// quote marks plus the sentence punctuation a model adds when it cuts a fragment short. A model
// that capitalizes a fragment's first letter, wraps an excerpt in quote marks the page lacks,
// closes a mid-sentence cut with a full stop, or emits a different Unicode/typographic encoding
// of the same characters would otherwise fail the substring check despite quoting the source
// verbatim. None of these rewrites touch word identity, so genuine paraphrases (different words)
// still fail. This mirrors the production citation-verification norm (normalize whitespace + case
// before exact match).
function normalizeForMatching(text: string): string {
  return normalizeExcerptText(text)
    .normalize('NFC')
    .toLowerCase()
    .replace(INNER_SINGLE_QUOTES_RE, "'")
    .replace(INNER_DOUBLE_QUOTES_RE, '"')
    .replace(DASHES_RE, '-')
    .replace(SURROUNDING_QUOTES_RE, '')
    .replace(TRAILING_PUNCTUATION_RE, '')
}

/** The single containment test for grounding: quotes, source metadata, and numeric spans. */
export function hasNormalizedText(material: string, value: string): boolean {
  const normalizedValue = normalizeForMatching(value)

  return normalizedValue.length > 0 && normalizeForMatching(material).includes(normalizedValue)
}

/**
 * Containment for a printed figure: the match must not sit inside a longer number, so "4" is not
 * found in "2024" or "4.5".
 */
export function hasNormalizedNumber(material: string, value: string): boolean {
  const needle = normalizeForMatching(value)
  if (needle.length === 0) {
    return false
  }

  const haystack = normalizeForMatching(material)
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (
      !(continuesNumber(haystack, at - 1, -1) || continuesNumber(haystack, at + needle.length, 1))
    ) {
      return true
    }
  }
  return false
}

function continuesNumber(text: string, index: number, step: 1 | -1): boolean {
  const char = text[index]
  if (char === undefined) {
    return false
  }
  if (DIGIT_RE.test(char)) {
    return true
  }
  return DECIMAL_SEPARATOR_RE.test(char) && DIGIT_RE.test(text[index + step] ?? '')
}

/**
 * The content paragraph sharing the most tokens with a quote that failed containment, verbatim.
 * A model that paraphrases or stitches clauses still points at a real passage; relocating to it
 * keeps evidence verbatim instead of admitting a severed prefix. Undefined below the overlap
 * floor, where the quote matches nothing on the page.
 */
export function locateVerbatimPassage(material: string, quote: string): string | undefined {
  const quoteTokens = matchTokens(quote)
  if (quoteTokens.size === 0) {
    return undefined
  }

  let best: { readonly text: string; readonly score: number } | undefined
  for (const paragraph of material.split(PARAGRAPH_SPLIT_RE)) {
    const text = paragraph.trim()
    if (text.length === 0) {
      continue
    }

    const tokens = matchTokens(text)
    const shared = [...quoteTokens].filter((token) => tokens.has(token)).length
    const score = shared / quoteTokens.size
    if (score >= MIN_REANCHOR_TOKEN_OVERLAP && (best === undefined || score > best.score)) {
      best = { text, score }
    }
  }

  return best?.text
}

/**
 * Where a rejected quote stops matching its page, counted in the same normalized characters the
 * containment test compares. Diverging within the first few words means the model paraphrased;
 * matching for hundreds of characters means it stitched together separate passages.
 */
export function describeNormalizedMismatch(material: string, value: string): NormalizedMismatch {
  const haystack = normalizeForMatching(material)
  const needle = normalizeForMatching(value)
  const matched = lastPassingIndex(needle.length, (length) =>
    haystack.includes(needle.slice(0, length))
  )

  return {
    matchedChars: matched,
    quoteChars: needle.length,
    divergedAt: needle.slice(matched, matched + MISMATCH_CONTEXT_CHARS),
  }
}

// Largest n in [0, limit] where `passes` holds, or 0 when none does. Containment is monotonic in
// prefix length, so the boundary is a bisection.
function lastPassingIndex(limit: number, passes: (n: number) => boolean): number {
  let low = 0
  let high = limit

  while (low < high) {
    const mid = Math.ceil((low + high) / 2)

    if (passes(mid)) {
      low = mid
    } else {
      high = mid - 1
    }
  }

  return low
}

/**
 * Which of the three defects behind one rejection this is: the model quoted the provider's
 * discovery snippet, the fetched text lost a middle span to its byte bound, or the quote is on no
 * page at all. Only the last is the model inventing evidence.
 */
export function quoteOrigin(input: QuoteOriginInput): QuoteOrigin {
  if (hasNormalizedText(input.snippet, input.quote)) {
    return 'snippet'
  }

  return hasElidedMiddle(input.content) ? 'elided_content' : 'absent'
}

/** Retrieved evidence is untrusted; any detected injection pattern rejects it. */
export function classifySafety(text: string): 'admitted' | 'rejected' {
  const threats = scanOutput(text)
  return threats.length > 0 ? 'rejected' : 'admitted'
}

/** Truncate on a UTF-16 code-point boundary; never splits a surrogate pair. */
export function truncateOnCodePoint(text: string, maxChars: number): string {
  const characters = [...text]
  if (characters.length <= maxChars) {
    return text
  }
  if (maxChars <= 0) {
    return ''
  }
  return `${characters.slice(0, maxChars - 1).join('')}${TRUNCATION_MARKER}`
}

/**
 * Truncates at the last sentence boundary within maxChars; falls back to a hard cut when no
 * boundary survives in the second half. Numeric claims need units and dates to survive the cut,
 * which a mid-sentence slice severs.
 */
export function truncateAtSentenceBoundary(text: string, maxChars: number): string {
  const head = truncateOnCodePoint(text, maxChars)
  if (head === text) {
    return text
  }

  let cutIndex = -1
  for (const match of head.matchAll(SENTENCE_END_RE)) {
    if (match.index === undefined) {
      continue
    }

    cutIndex = match[0] === '\n' ? match.index : match.index + 1
  }

  return cutIndex >= Math.floor(maxChars * MIN_SENTENCE_CUT_RATIO)
    ? head.slice(0, cutIndex).trimEnd()
    : head
}

export function truncateForGap(value: string): string {
  return truncateOnCodePoint(value, MAX_GAP_VALUE_CHARS)
}

function normalizeProse(text: string): string {
  return text.replace(WHITESPACE_RUN_RE, ' ')
}

function matchTokens(text: string): ReadonlySet<string> {
  return new Set(normalizeForMatching(text).split(' ').filter(Boolean))
}

// --- Freshness policy ---

type FreshnessDisposition = 'admit' | 'admit_with_penalty' | 'reject'

export function freshnessDisposition(
  source: ResearchSource,
  freshness: ResearchFreshness
): FreshnessDisposition {
  const date = dateForFreshness(source, freshness.field)
  if (
    date === undefined ||
    source.dateConfidence === undefined ||
    source.dateConfidence === 'low'
  ) {
    return 'admit_with_penalty'
  }

  if (isOutsideWindow(date, freshness)) {
    return source.dateConfidence === 'high' ? 'reject' : 'admit_with_penalty'
  }

  return 'admit'
}

function dateForFreshness(
  source: ResearchSource,
  field: ResearchFreshness['field']
): string | undefined {
  if (field === 'publishedOn') {
    return source.publishedOn
  }
  if (field === 'updatedOn') {
    return source.updatedOn
  }
  // `either` resolves updatedOn ?? publishedOn consistently.
  return source.updatedOn ?? source.publishedOn
}

function isOutsideWindow(day: string, freshness: ResearchFreshness): boolean {
  const dayMs = parseIsoDay(day)
  if (dayMs === undefined) {
    return true
  }

  const fromMs = freshness.fromOn !== undefined ? parseIsoDay(freshness.fromOn) : undefined
  const toMs = freshness.toOn !== undefined ? parseIsoDay(freshness.toOn) : undefined
  if (fromMs !== undefined && dayMs < fromMs) {
    return true
  }
  if (toMs !== undefined && dayMs > toMs) {
    return true
  }
  return false
}

import type { MacroSeriesSpec } from '@/trading/features/market-data/macro-extract/catalogue'
import type { VnNumberToken } from '@/trading/kernel/market/vn-number'
import { isQuarterEndMonth } from '@/trading/kernel/market/month'
import { vnNumberTokensIn } from '@/trading/kernel/market/vn-number'

const WHITESPACE_RE = /\s+/g
const MINIMUM_QUOTE_CHARS = 20
const MAXIMUM_QUOTE_CHARS = 500
const VALUE_TOLERANCE = 1e-6
const FALL_CUE_RE = /giảm|sụt|[-\u2212]/i
/** Words between a number and the one before it that can still carry its direction. */
const DIRECTION_WINDOW_CHARS = 12

export interface ExtractionAnswer {
  readonly seriesId: string
  readonly value: number
  readonly period: string
  readonly quote: string
}

type RejectionReason =
  | 'unknown-series'
  | 'quote-length'
  | 'quote-not-in-source'
  | 'number-not-in-quote'
  | 'sign'
  | 'period'
  | 'not-quarter-end'
  | 'out-of-range'

interface RejectedAnswer {
  readonly answer: ExtractionAnswer
  readonly reason: RejectionReason
}

interface VerifyInput {
  readonly answers: readonly ExtractionAnswer[]
  readonly series: readonly MacroSeriesSpec[]
  readonly sourceText: string
  readonly allowedMonths: ReadonlySet<string>
}

/** The number an answer cites, and where the number before it ends. */
interface QuotedNumber {
  readonly token: VnNumberToken
  readonly previousEnd: number
}

interface VerifiedAnswers {
  readonly accepted: readonly ExtractionAnswer[]
  readonly rejected: readonly RejectedAnswer[]
}

function toNormalizedText(text: string): string {
  return text.replace(WHITESPACE_RE, ' ').trim()
}

/** The text writes the magnitude and states a fall in words, so the match ignores the sign. */
function toQuotedNumber(quote: string, value: number): QuotedNumber | undefined {
  let previousEnd = 0

  for (const token of vnNumberTokensIn(quote)) {
    if (Math.abs(token.value - Math.abs(value)) < VALUE_TOLERANCE) {
      return { token, previousEnd }
    }

    previousEnd = token.end
  }

  return undefined
}

/** A change the text calls a decline is only stored negative, and one it calls a rise never is. */
function isSignConsistent(quote: string, quoted: QuotedNumber, value: number): boolean {
  const { token, previousEnd } = quoted
  const lead = quote.slice(Math.max(previousEnd, token.start - DIRECTION_WINDOW_CHARS), token.start)

  return FALL_CUE_RE.test(lead) === value < 0
}

function rejectionOf(
  answer: ExtractionAnswer,
  spec: MacroSeriesSpec | undefined,
  input: VerifyInput & { readonly source: string }
): RejectionReason | undefined {
  const quote = toNormalizedText(answer.quote)

  if (spec === undefined) {
    return 'unknown-series'
  }

  if (quote.length < MINIMUM_QUOTE_CHARS || quote.length > MAXIMUM_QUOTE_CHARS) {
    return 'quote-length'
  }

  if (!input.source.includes(quote)) {
    return 'quote-not-in-source'
  }

  const quoted = toQuotedNumber(quote, answer.value)

  if (quoted === undefined) {
    return 'number-not-in-quote'
  }

  if (spec.measure === 'change' && !isSignConsistent(quote, quoted, answer.value)) {
    return 'sign'
  }

  if (!input.allowedMonths.has(answer.period)) {
    return 'period'
  }

  if (spec.quarterly && !isQuarterEndMonth(answer.period)) {
    return 'not-quarter-end'
  }

  return answer.value < spec.minimum || answer.value > spec.maximum ? 'out-of-range' : undefined
}

/** One bad answer is dropped alone; a series answered twice for a month keeps its first. */
export function verifyAnswers(input: VerifyInput): VerifiedAnswers {
  const context = { ...input, source: toNormalizedText(input.sourceText) }
  const specs = new Map(input.series.map((spec) => [spec.id, spec]))
  const accepted: ExtractionAnswer[] = []
  const rejected: RejectedAnswer[] = []
  const seen = new Set<string>()

  for (const answer of input.answers) {
    const reason = rejectionOf(answer, specs.get(answer.seriesId), context)
    const key = `${answer.seriesId}|${answer.period}`

    if (reason !== undefined) {
      rejected.push({ answer, reason })
    } else if (!seen.has(key)) {
      seen.add(key)
      accepted.push({ ...answer, quote: toNormalizedText(answer.quote) })
    }
  }

  return { accepted, rejected }
}

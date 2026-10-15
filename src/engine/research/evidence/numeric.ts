import { describeNormalizedMismatch, hasNormalizedNumber, hasNormalizedText } from './normalize'

// Same measure, values apart by more than rounding: "4240.8" vs "4241" is one figure printed at
// two precisions, not two disagreeing readings.
export const RELATIVE_VALUE_TOLERANCE = 0.005
const PLAIN_NUMBER_RE = /^([+-]?)(\d[\d.,]*)(%?)$/
const GROUPED_INTEGER_RE = /^\d{1,3}(?:[.,]\d{3})+$/
const SINGLE_MARK_RE = /^(\d+)[.,](\d+)$/
const MARKS_RE = /[.,]/g
const DIGITS_RE = /^\d+$/
const SHORT_INTEGER_RE = /^[1-9]\d{0,2}$/
const THOUSANDS_GROUP_DIGITS = 3

export const NUMERIC_SPAN_FIELDS = ['valueText', 'unitText', 'dateText'] as const

type NumericSpanField = (typeof NUMERIC_SPAN_FIELDS)[number]

// dateText mirrors the zod-inferred optional (`string | undefined`) under exactOptionalPropertyTypes.
export interface NumericSpanText {
  readonly valueText: string
  readonly unitText: string
  readonly dateText?: string | undefined
  /** The claim's canonical number.value that valueText has to agree with, when known. */
  readonly claimValue?: string | undefined
}

export interface CompleteNumericSpans extends NumericSpanText {
  readonly dateText: string
}

/** The two places a span may be grounded: the quotes the model chose, and the page they came from. */
export interface SpanLookup {
  readonly quotes: readonly string[]
  readonly page: string
}

// A source that shows no date cannot ground an exact numeric link; the claim then relies on its
// other sources.
export function completeNumericSpans(spans: NumericSpanText): CompleteNumericSpans | undefined {
  if (spans.dateText === undefined) {
    return undefined
  }
  return { ...spans, dateText: spans.dateText }
}

// Each span is sought across every excerpt the source contributed, never in a joined string: a
// concatenation would let a figure match across two quote boundaries that the page never printed
// together.
export function missingNumericSpans(
  spans: CompleteNumericSpans,
  excerptTexts: readonly string[]
): readonly NumericSpanField[] {
  return NUMERIC_SPAN_FIELDS.filter(
    (field) => !excerptTexts.some((text) => hasSpanInExcerpt(text, field, spans[field]))
  )
}

export function hasSpanInExcerpt(text: string, field: NumericSpanField, span: string): boolean {
  return field === 'valueText' ? hasNormalizedNumber(text, span) : hasNormalizedText(text, span)
}

/**
 * True only when valueText parses as a plain number or percent and no reading of it is within
 * rounding distance of the claim's canonical value. Anything else (suffixes, currency, prose) is
 * left for the reviewer.
 */
export function isValueTextContradicting(claimValue: string, valueText: string): boolean {
  const claim = Number(claimValue)
  const readings = numberReadings(valueText.trim())

  if (!Number.isFinite(claim) || readings === undefined) {
    return false
  }
  return !readings.some((reading) => withinTolerance(claim, reading))
}

function withinTolerance(a: number, b: number): boolean {
  const magnitude = Math.max(Math.abs(a), Math.abs(b))

  return magnitude === 0 || Math.abs(a - b) / magnitude <= RELATIVE_VALUE_TOLERANCE
}

// "1.234" is 1234 in vi and 1.234 in en, so an ambiguous figure yields both readings.
function numberReadings(text: string): readonly number[] | undefined {
  const match = PLAIN_NUMBER_RE.exec(text)
  const sign = match?.[1]
  const body = match?.[2]
  const readings = body === undefined ? undefined : separatorReadings(body)

  if (sign === undefined || readings === undefined) {
    return undefined
  }

  const values = readings.map((reading) => Number(`${sign}${reading}`))

  return match?.[3] === '%' ? [...values, ...values.map((value) => value / 100)] : values
}

function separatorReadings(body: string): readonly string[] | undefined {
  const marks = body.match(MARKS_RE) ?? []

  if (marks.length === 0) {
    return [body]
  }
  if (new Set(marks).size === 2) {
    return mixedMarkReadings(body)
  }
  if (marks.length > 1) {
    return GROUPED_INTEGER_RE.test(body) ? [body.replace(MARKS_RE, '')] : undefined
  }
  return singleMarkReadings(body)
}

// The last mark is the decimal point; the integer part must be thousands-grouped by the other.
function mixedMarkReadings(body: string): readonly string[] | undefined {
  const at = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','))
  const integer = body.slice(0, at)
  const fraction = body.slice(at + 1)

  if (!GROUPED_INTEGER_RE.test(integer) || integer.includes(body.charAt(at))) {
    return undefined
  }
  return DIGITS_RE.test(fraction) ? [`${integer.replace(MARKS_RE, '')}.${fraction}`] : undefined
}

function singleMarkReadings(body: string): readonly string[] | undefined {
  const parts = SINGLE_MARK_RE.exec(body)
  const integer = parts?.[1]
  const fraction = parts?.[2]

  if (integer === undefined || fraction === undefined) {
    return undefined
  }

  const decimal = `${integer}.${fraction}`

  return SHORT_INTEGER_RE.test(integer) && fraction.length === THOUSANDS_GROUP_DIGITS
    ? [decimal, `${integer}${fraction}`]
    : [decimal]
}

/**
 * Debug record for spans that failed the check above: the span text, how far it got in the closest
 * quote, and how far it got in the whole page. A span the page carries but no quote does is one the
 * model could not reach — a price table keeps its unit in a column header and its date above the
 * rows. Both zero means the model wrote the span itself.
 */
export function describeMissingSpans(
  spans: CompleteNumericSpans,
  missing: readonly NumericSpanField[],
  lookup: SpanLookup
): Readonly<Record<string, string | number>> {
  return Object.fromEntries(
    missing.flatMap((field) => [
      [field, spans[field]],
      [`${field}MatchedChars`, bestMatchedChars(spans[field], lookup.quotes)],
      [`${field}PageChars`, bestMatchedChars(spans[field], [lookup.page])],
    ])
  )
}

function bestMatchedChars(span: string, texts: readonly string[]): number {
  return texts.reduce(
    (best, text) => Math.max(best, describeNormalizedMismatch(text, span).matchedChars),
    0
  )
}

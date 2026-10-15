// Which Intl options each printed unit uses, and the one funnel every rendered number passes
// through. Split from `format.ts`, which owns the vocabulary — which unit a given value is printed
// in — so the option table and its memo have one place to live and neither file carries the other.
import type { Locale } from '@/core/types/locale'
import { SPEND_DECIMALS } from '@/core/utils/cost'
import { cachedFormatter } from '@/trading/render/datetime'

/** What a cell prints where the value it would carry does not exist - a sleeve bounded by a floor
 *  rather than a cap, a lot acquired at no cost, a figure that was never a finite number. Absent is
 *  not zero, and an empty cell reads as a rendering fault rather than as a fact. */
export const ABSENT_CELL = '—'
export const CRYPTO_SUBUNIT_DIGITS = 8
export const FRACTION_DIGITS = 2
const PERCENT_PER_UNIT = 100
/** The resolution `formatWholeFraction` prints a 0-1 share at: one whole percent. */
export const WEIGHT_QUANTUM = 0.01
/** The resolution `formatFraction` prints a 0-1 share at: two decimals of a percent. */
export const FRACTION_QUANTUM = 10 ** -FRACTION_DIGITS / PERCENT_PER_UNIT
/** The resolution `formatScoreValue` prints a score and its contributions at: two decimals. */
export const SCORE_QUANTUM = 0.01
export const SUB_UNIT_SIGNIFICANT_DIGITS = 4
/** Whether a rendered number carries any magnitude at all, once its own rounding has been applied. */
const SIGNIFICANT_DIGIT_RE = /[1-9]/
/** Reads back through `Number`, so a fixed ASCII locale rather than the operator's. */
const MACHINE_LOCALE = 'en-US'

/** One option set per unit the trading surface prints. Naming them apart is what keeps a 40% target
 *  from rendering as 0.4%, and a factor score from losing the sign that carries its direction. */
const NUMBER_FORMATS = {
  amount: { maximumFractionDigits: FRACTION_DIGITS },
  /** Significant digits, not decimal places: below one currency unit every digit that carries the
   *  value sits after the point, and a top-250 coin can trade at 0.00002. */
  subUnit: { maximumSignificantDigits: SUB_UNIT_SIGNIFICANT_DIGITS },
  /** Column forms of the two above: a varying digit count puts the decimal point in a different
   *  place on every row, and a price is almost always read in a stack. */
  amountFixed: {
    minimumFractionDigits: FRACTION_DIGITS,
    maximumFractionDigits: FRACTION_DIGITS,
  },
  subUnitFixed: {
    minimumSignificantDigits: SUB_UNIT_SIGNIFICANT_DIGITS,
    maximumSignificantDigits: SUB_UNIT_SIGNIFICANT_DIGITS,
  },
  /** Every digit the operator could have stated, which crypto quotes to eight: the default three
   *  print 0.0001 BTC as 0, and two decimals print a 1.39973239 fill as 1.4. */
  exact: { maximumFractionDigits: CRYPTO_SUBUNIT_DIGITS },
  /** Money at market scale: VND turnover runs to thirteen digits, of which three carry the story.
   *  Significant digits rather than a fixed decimal, so a leader printed in nghìn tỷ keeps the same
   *  resolution as the rows below it in tỷ — one fractional digit rounded 1.048 tỷ to "1 nghìn tỷ"
   *  beside a share the reader could not reconcile with it. The unit is spelled out because the
   *  short forms are ambiguous where it matters most — vi renders 197 tỷ as "197 T", which reads
   *  as a thousand times itself. */
  compact: { notation: 'compact', compactDisplay: 'long', maximumSignificantDigits: 3 },
  count: { maximumFractionDigits: 0 },
  percent: { style: 'percent', maximumFractionDigits: FRACTION_DIGITS },
  percentWhole: { style: 'percent', maximumFractionDigits: 0 },
  /** Column form: a varying digit count puts the decimal point in a different place on every row. */
  percentFixed: {
    style: 'percent',
    minimumFractionDigits: FRACTION_DIGITS,
    maximumFractionDigits: FRACTION_DIGITS,
  },
  score: {
    minimumFractionDigits: FRACTION_DIGITS,
    maximumFractionDigits: FRACTION_DIGITS,
    signDisplay: 'always',
  },
  ratio: { minimumFractionDigits: FRACTION_DIGITS, maximumFractionDigits: FRACTION_DIGITS },
  /** LLM spend, quoted far below a cent, so it keeps its own precision rather than a currency's. */
  spend: { minimumFractionDigits: SPEND_DECIMALS, maximumFractionDigits: SPEND_DECIMALS },
} as const satisfies Record<string, Intl.NumberFormatOptions>

type NumberFormatName = keyof typeof NUMBER_FORMATS

// Locale is a closed two-member union and the formats above are fixed, so this map is bounded by
// construction and needs no eviction. Constructing an Intl.NumberFormat per rendered row is the one
// hot path here.
const formatters = new Map<string, Intl.NumberFormat>()

/** Intl keeps the sign of a value that rounds away to nothing, and neither `-0%` nor `+0,00` is a
 *  move that happened. Guarded here rather than at each renderer, so no unit can print one. A
 *  non-finite value is no figure at all, and `0%` or `0.00` would state a measurement. */
export function formatNumber(locale: Locale, name: NumberFormatName, value: number): string {
  if (!Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const text = numberFormatter(locale, name).format(value)

  return hasMagnitude(text) ? text : unsignedFormatter(locale, name).format(0)
}

/** A fixed number of decimals, for a precision the caller learns at run time (a currency's minor
 *  units, a board's decimals) rather than one of the named units above. Under the same guards. */
export function formatFixedDigits(locale: Locale, value: number, digits: number): string {
  if (!Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const formatter = cachedFormatter(
    formatters,
    `${locale}:fixed:${digits}`,
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
  )
  const text = formatter.format(value)

  return hasMagnitude(text) ? text : formatter.format(0)
}

/** Whether a rendered number still carries a magnitude, or rounded away to zero at this quantity's
 *  precision. The one owner of that question: a direction read off the raw value instead asserts a
 *  move the number beside it no longer shows. */
export function hasMagnitude(text: string): boolean {
  return SIGNIFICANT_DIGIT_RE.test(text)
}

function numberFormatter(locale: Locale, name: NumberFormatName): Intl.NumberFormat {
  return cachedFormatter(
    formatters,
    `${locale}:${name}`,
    () => new Intl.NumberFormat(locale, NUMBER_FORMATS[name])
  )
}

/** The same format with a forced sign dropped. Only `score` forces one, and a forced sign on a
 *  value that rounded away asserts a direction the number does not carry. */
function unsignedFormatter(locale: Locale, name: NumberFormatName): Intl.NumberFormat {
  return cachedFormatter(
    formatters,
    `${locale}:${name}:unsigned`,
    () => new Intl.NumberFormat(locale, { ...NUMBER_FORMATS[name], signDisplay: 'auto' })
  )
}

interface ApportionedPart {
  readonly index: number
  readonly floor: number
  readonly remainder: number
}

/** Parts rounded together so they still add up to the whole a surface prints beside them. Largest
 *  remainder: every part rounds down to `quantum`, then the units rounding left over go to the
 *  parts that gave up the most. Rounding each on its own is what printed five macro weights summing
 *  to 99% and five contributions summing to a score one hundredth away from the one above them.
 *
 *  `quantum` is the resolution the caller will print at, in the unit the values carry: a whole
 *  percent of a 0-1 share and two decimals of a score are both 0.01. */
export function apportion(values: readonly number[], quantum: number): readonly number[] {
  if (values.length === 0 || quantum <= 0) {
    return values
  }

  const parts: readonly ApportionedPart[] = values.map((value, index) => {
    const units = value / quantum
    const floor = Math.floor(units)

    return { index, floor, remainder: units - floor }
  })
  const whole = Math.round(
    printedValue(
      values.reduce((sum, value) => sum + value, 0),
      quantum
    ) / quantum
  )
  const shortfall = whole - parts.reduce((sum, part) => sum + part.floor, 0)
  const raised = new Set(
    parts
      .toSorted((left, right) => right.remainder - left.remainder)
      .slice(0, Math.max(shortfall, 0))
      .map((part) => part.index)
  )

  return parts.map((part) => (part.floor + (raised.has(part.index) ? 1 : 0)) * quantum)
}

/** The whole as a surface prints it, rounded by `Intl` itself: it rounds the shortest decimal a
 *  float reads as, so -0.295 prints -0.30 where `Math.round` on the scaled float, or `toFixed` on
 *  the exact binary value, lands on -0.29. */
function printedValue(value: number, quantum: number): number {
  const digits = Math.max(0, Math.round(-Math.log10(quantum)))
  const formatter = cachedFormatter(
    formatters,
    `${MACHINE_LOCALE}:apportion:${digits}`,
    () =>
      new Intl.NumberFormat(MACHINE_LOCALE, { maximumFractionDigits: digits, useGrouping: false })
  )

  return Number(formatter.format(value))
}

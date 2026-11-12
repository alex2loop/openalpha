// Which Intl options each printed unit uses, and the one funnel every rendered number passes
// through. Split from `format.ts`, which owns the vocabulary — which unit a given value is printed
// in — so the option table and its memo have one place to live and neither file carries the other.
import type { Locale } from '@/core/types/locale'
import { FRACTION_DIGITS, hasMagnitude, NUMBER_FORMATS } from '@/i18n'
import { cachedFormatter } from '@/trading/render/datetime'

/** What a cell prints where the value it would carry does not exist - a segment bounded by a floor
 *  rather than a cap, a lot acquired at no cost, a figure that was never a finite number. Absent is
 *  not zero, and an empty cell reads as a rendering fault rather than as a fact. */
export const ABSENT_CELL = '—'
const PERCENT_PER_UNIT = 100
/** The resolution `formatWholeFraction` prints a 0-1 share at: one whole percent. */
export const WEIGHT_QUANTUM = 0.01
/** The resolution `formatFraction` prints a 0-1 share at: two decimals of a percent. */
export const FRACTION_QUANTUM = 10 ** -FRACTION_DIGITS / PERCENT_PER_UNIT
/** The resolution `formatScoreValue` prints a score and its contributions at: two decimals. */
export const SCORE_QUANTUM = 0.01
/** Reads back through `Number`, so a fixed ASCII locale rather than the operator's. */
const MACHINE_LOCALE = 'en-US'

type NumberFormatName = keyof typeof NUMBER_FORMATS

// Locale is a closed two-member union and the formats are fixed, so this map is bounded by
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

import { locale } from '@/web/state/session'
import { isAmbiguousGrouping } from '@/web/text/decimal'
import { ABSENT_CELL, DOWN_GLYPH, UP_GLYPH } from '@/web/text/glyphs'

/** Percent per whole: a fraction times this is a percent. */
export const PERCENT = 100
const USD_DIGITS = 2
const USD_CENT = 0.01
const USD_SMALL_DIGITS = 2
const PERCENT_DIGITS = 2
const PRICE_DIGITS = 2
// A price under 1 with no board scale keeps this many digits after its leading zeros.
const SMALL_PRICE_EXTRA_DIGITS = 2
const PRICE_DIGITS_MAX = 10
// A quantity keeps up to a satoshi, and no trailing zeros.
const QUANTITY_DIGITS_MAX = 8
// From here a cash amount prints whole units: cents on a million are noise.
const AMOUNT_WHOLE_FROM = 1_000
// A compact total keeps three significant digits: `76,5 tỷ`, `850 triệu`. Vietnamese spells its units
// out, because the short form (`76,5 T`) reads as a thousand times itself.
const COMPACT_SIGNIFICANT_DIGITS = 3
const COMPACT_DISPLAY = Object.freeze({ vi: 'long', en: 'short' } as const)
const ZERO_TEXT = /^[^1-9]*$/
const ISO_CURRENCY = /^[A-Z]{3}$/

/** How a board prints a price: `value / divisor` at `decimals`. */
interface PriceDisplay {
  readonly divisor: number
  readonly decimals: number
}

type Tone = 'up' | 'down' | 'flat'

/** A money total: whole units beside the wire's currency code. */
export const WHOLE_DISPLAY: PriceDisplay = Object.freeze({ divisor: 1, decimals: 0 })

// One per page language and shape, so bounded by construction.
const formatters = new Map<string, Intl.NumberFormat>()
// One per currency code the daemon names.
const wholeCurrencies = new Map<string, boolean>()

/** `WHOLE_DISPLAY` for a currency with no minor unit (VND, JPY); absent for one with cents, or one
 *  that is no ISO code (USDT). */
export function wholeUnitsDisplay(currency: string): PriceDisplay | undefined {
  let isWhole = wholeCurrencies.get(currency)

  if (isWhole === undefined) {
    isWhole =
      ISO_CURRENCY.test(currency) &&
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits === 0
    wholeCurrencies.set(currency, isWhole)
  }

  return isWhole ? WHOLE_DISPLAY : undefined
}

/** A USD amount at cent precision in the page's language; one under a cent keeps two significant
 *  digits, so a model call's cost never reads as zero. A missing one prints `ABSENT_CELL`. */
export function formatUsd(value: number | undefined): string {
  if (value !== undefined && value !== 0 && Math.abs(value) < USD_CENT) {
    return buildFormatter('usd-small', { maximumSignificantDigits: USD_SMALL_DIGITS }).format(value)
  }

  return formatFixed(value, USD_DIGITS)
}

/** A number at exactly `digits` decimals in the page's language; a missing one prints
 *  `ABSENT_CELL`. */
export function formatFixed(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return formatterFor(digits).format(value)
}

/** A share of the whole, given as a fraction (`0.1425`), at fixed decimals so a column lines up:
 *  `14,25%`, as `/portfolio` prints it. */
export function formatFixedFraction(fraction: number | undefined): string {
  if (fraction === undefined || !Number.isFinite(fraction)) {
    return ABSENT_CELL
  }

  return buildFormatter(`percent:${PERCENT_DIGITS}`, {
    style: 'percent',
    minimumFractionDigits: PERCENT_DIGITS,
    maximumFractionDigits: PERCENT_DIGITS,
  }).format(fraction)
}

/** A held or traded quantity: whole shares stay whole, a coin keeps its decimals. */
export function formatQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return buildFormatter('quantity', { maximumFractionDigits: QUANTITY_DIGITS_MAX }).format(value)
}

/** A quantity in a list: the decimals a price of its size keeps, no trailing zeros. A coin's
 *  `68,14119198` reads `68,14`; `formatQuantity` stays the exact figure. */
export function formatShortQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const digits = unscaledDigits(value)

  return buildFormatter(`quantity:${digits}`, { maximumFractionDigits: digits }).format(value)
}

/** A stored figure as a form field starts with it: the page's decimal mark, no grouping, up to a
 *  satoshi; empty when absent. One a thousands reading could misread ("2,125") takes a trailing
 *  zero, so the field reads back as the same number. */
export function formatFieldFigure(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ''
  }

  const field = buildFormatter('field', {
    useGrouping: false,
    maximumFractionDigits: QUANTITY_DIGITS_MAX,
  })
  const text = field.format(value)

  return isAmbiguousGrouping(field.format(Math.abs(value))) ? `${text}0` : text
}

/** A cash amount in its own currency: whole units from `AMOUNT_WHOLE_FROM`, else cents. */
export function formatAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return Math.abs(value) >= AMOUNT_WHOLE_FROM
    ? formatPrice(value, WHOLE_DISPLAY)
    : formatPrice(value, undefined)
}

/** A money total at a glance in the page's language (`76,5 tỷ`, `1.2T`), with no currency; a missing
 *  one prints `ABSENT_CELL`. */
export function formatCompactAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return buildFormatter('compact', {
    notation: 'compact',
    compactDisplay: COMPACT_DISPLAY[locale.value],
    maximumSignificantDigits: COMPACT_SIGNIFICANT_DIGITS,
  }).format(value)
}

/** As `formatCompactAmount`, led by the direction of a net figure: `▲ 310 tỷ`, `▼ -520 tỷ`; zero
 *  carries no mark. */
export function formatSignedCompactAmount(value: number | undefined): string {
  const text = formatCompactAmount(value)

  if (value === undefined || value === 0 || !Number.isFinite(value)) {
    return text
  }

  return `${value > 0 ? UP_GLYPH : DOWN_GLYPH} ${text}`
}

/** A price on its board's scale (`/v1/markets` `priceDisplay`); a money total passes
 *  `{ divisor: 1, decimals: 0 }`. No scale known prints cents, and more digits under 1 so a
 *  sub-cent price never reads as zero. */
export function formatPrice(value: number | undefined, display: PriceDisplay | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const { divisor, decimals } = display ?? { divisor: 1, decimals: unscaledDigits(value) }

  return formatterFor(decimals).format(value / divisor)
}

/** A percent-valued field without its sign: `5,80%`, a distance either way. */
export function formatPercent(value: number | undefined): string {
  return readPercent(value === undefined ? undefined : Math.abs(value)).text
}

/** A percent-valued field (`changePct`) as `▲ 1,31%` or `▼ -0,49%`; one that rounds to zero
 *  carries no sign and no arrow. */
export function formatSignedPercent(value: number | undefined): string {
  const { text, tone } = readPercent(value)

  if (tone === 'flat') {
    return text
  }

  return tone === 'up' ? `${UP_GLYPH} ${text}` : `${DOWN_GLYPH} -${text}`
}

/** As `formatSignedPercent`, for a field given as a fraction (`returnPct`, `0.05` is 5%). */
export function formatSignedFraction(fraction: number | undefined): string {
  return formatSignedPercent(fraction === undefined ? undefined : fraction * PERCENT)
}

/** The direction a percent reads in, judged off its rendered text. */
export function toneOfPercent(value: number | undefined): Tone {
  return readPercent(value).tone
}

function readPercent(value: number | undefined): { readonly text: string; readonly tone: Tone } {
  if (value === undefined || !Number.isFinite(value)) {
    return { text: ABSENT_CELL, tone: 'flat' }
  }

  const text = `${formatterFor(PERCENT_DIGITS).format(Math.abs(value))}%`

  if (ZERO_TEXT.test(text)) {
    return { text, tone: 'flat' }
  }

  return { text, tone: value > 0 ? 'up' : 'down' }
}

function unscaledDigits(value: number): number {
  const magnitude = Math.abs(value)

  if (magnitude === 0 || magnitude >= 1) {
    return PRICE_DIGITS
  }

  const leadingZeros = Math.floor(-Math.log10(magnitude))

  return Math.min(PRICE_DIGITS_MAX, leadingZeros + SMALL_PRICE_EXTRA_DIGITS)
}

function formatterFor(digits: number): Intl.NumberFormat {
  return buildFormatter(`fixed:${digits}`, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function buildFormatter(shape: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const language = locale.value
  const key = `${language}:${shape}`
  let formatter = formatters.get(key)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language, options)
    formatters.set(key, formatter)
  }

  return formatter
}

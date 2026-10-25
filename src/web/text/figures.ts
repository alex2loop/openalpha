import { locale } from '@/web/state/session'
import { ABSENT_CELL, DOWN_GLYPH, UP_GLYPH } from '@/web/text/glyphs'

const USD_DIGITS = 2
const PERCENT_DIGITS = 2
const PRICE_DIGITS = 2
// A price under 1 with no board scale keeps this many digits after its leading zeros.
const SMALL_PRICE_EXTRA_DIGITS = 2
const PRICE_DIGITS_MAX = 10
const ZERO_TEXT = /^[^1-9]*$/

/** How a board prints a price: `value / divisor` at `decimals`. */
interface PriceDisplay {
  readonly divisor: number
  readonly decimals: number
}

type Tone = 'up' | 'down' | 'flat'

// One per page language and digit count, so bounded by construction.
const formatters = new Map<string, Intl.NumberFormat>()

/** A USD amount at cent precision in the page's language; a missing one prints `ABSENT_CELL`. */
export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return formatterFor(USD_DIGITS).format(value)
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

/** A percent-valued field (`changePct`) as `▲ 1,31%` or `▼ -0,49%`; one that rounds to zero
 *  carries no sign and no arrow. */
export function formatSignedPercent(value: number | undefined): string {
  const { text, tone } = readPercent(value)

  if (tone === 'flat') {
    return text
  }

  return tone === 'up' ? `${UP_GLYPH} ${text}` : `${DOWN_GLYPH} -${text}`
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
  const language = locale.value
  const key = `${language}:${digits}`
  let formatter = formatters.get(key)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    formatters.set(key, formatter)
  }

  return formatter
}

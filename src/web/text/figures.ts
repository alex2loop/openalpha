import { locale } from '@/web/state/session'
import { ABSENT_CELL } from '@/web/text/glyphs'

const USD_DIGITS = 2

// One per page language and digit count, each a named constant, so bounded by construction.
const fixedFormatters = new Map<string, Intl.NumberFormat>()

/** A USD amount at cent precision in the page's language; a missing one prints `ABSENT_CELL`. */
export function formatUsd(value: number | undefined): string {
  return formatFixed(value, USD_DIGITS)
}

/** A number at exactly `digits` decimals in the page's language; a missing one prints
 *  `ABSENT_CELL`. */
export function formatFixed(value: number | undefined, digits: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const language = locale.value
  const key = `${language}:${digits}`
  let formatter = fixedFormatters.get(key)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
    fixedFormatters.set(key, formatter)
  }

  return formatter.format(value)
}

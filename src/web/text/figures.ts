import { locale } from '@/web/state/session'
import { ABSENT_CELL } from '@/web/text/glyphs'

const USD_DIGITS = 2

// One per page language, so bounded by construction.
const usdFormatters = new Map<string, Intl.NumberFormat>()

/** A USD amount at cent precision in the page's language; a missing one prints `ABSENT_CELL`. */
export function formatUsd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const language = locale.value
  let formatter = usdFormatters.get(language)

  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(language, {
      minimumFractionDigits: USD_DIGITS,
      maximumFractionDigits: USD_DIGITS,
    })
    usdFormatters.set(language, formatter)
  }

  return formatter.format(value)
}

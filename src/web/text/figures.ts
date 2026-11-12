import {
  CRYPTO_SUBUNIT_DIGITS,
  FRACTION_DIGITS,
  hasMagnitude,
  isIsoCurrency,
  isSubUnit,
  minorUnitsOf,
  NUMBER_FORMATS,
  priceDecimals,
} from '@/i18n'
import { locale } from '@/web/state/session'
import { isAmbiguousGrouping } from '@/web/text/decimal'
import { ABSENT_CELL, DOWN_GLYPH, UP_GLYPH } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** Percent per whole: a fraction times this is a percent. */
export const PERCENT = 100
const USD_DIGITS = 2
const USD_CENT = 0.01
const USD_SMALL_DIGITS = 2
const PERCENT_DIGITS = 2
// A quantity in a list under 1 keeps this many digits after its leading zeros.
const LISTED_EXTRA_DIGITS = 2
const LISTED_DIGITS_MAX = 10

/** How a board prints a price: `value / divisor` at `decimals`. */
interface PriceDisplay {
  readonly divisor: number
  readonly decimals: number
}

/** A price in a currency with no board scale: its own precision decides the digits. */
interface CurrencyPrice {
  readonly currency: string
}

/** How a market prints a price (`/v1/markets`): on its board's scale, else in its currency. */
export type PriceFormat = PriceDisplay | CurrencyPrice

export type Tone = 'up' | 'down' | 'flat'

// One per page language and shape, so bounded by construction.
const formatters = new Map<string, Intl.NumberFormat>()

/** A USD amount at cent precision in the page's language; one under a cent keeps two significant
 *  digits, so a model call's cost never reads as zero. A missing one prints `ABSENT_CELL`. */
export function formatUsd(value: number | undefined): string {
  if (value !== undefined && value !== 0 && Math.abs(value) < USD_CENT) {
    return buildFormatter('usd-small', { maximumSignificantDigits: USD_SMALL_DIGITS }).format(value)
  }

  return formatFixed(value, USD_DIGITS)
}

/** A USD amount at cent precision whatever its size: the rows of a breakdown, which add up to a
 *  total printed the same way. A spend that rounds to zero cents reads `<0,01`, never zero. */
export function formatUsdCents(value: number | undefined): string {
  const text = formatFixed(value, USD_DIGITS)

  if (value === undefined || !Number.isFinite(value) || value === 0 || hasMagnitude(text)) {
    return text
  }

  return tr('ui.office.cost.underCent', { cent: formatFixed(USD_CENT, USD_DIGITS) })
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

  return sharedFormatter('percentFixed').format(fraction)
}

/** A held or traded quantity: whole shares stay whole, a coin keeps its decimals. */
export function formatQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return printed(sharedFormatter('exact'), value)
}

/** A quantity in a list: two decimals, more under 1 so a small one never reads as zero, no trailing
 *  zeros. A coin's `68,14119198` reads `68,14`; `formatQuantity` stays the exact figure. */
export function formatShortQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  const digits = listedDigits(value)

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
    maximumFractionDigits: CRYPTO_SUBUNIT_DIGITS,
  })
  const text = field.format(value)

  return isAmbiguousGrouping(field.format(Math.abs(value))) ? `${text}0` : text
}

/** A figure to two decimals, or four significant digits under one unit, in the page's language: what
 *  `/portfolio` prints where no currency's precision is known. */
export function formatAmount(value: number | undefined): string {
  if (!isFigure(value)) {
    return ABSENT_CELL
  }

  return printed(sharedFormatter(isSubUnit(value) ? 'subUnit' : 'amount'), value)
}

/** Money in its own currency's precision, then its code: a đồng has no cents and a dollar has two.
 *  A token with no minor units of its own keeps significant digits below one unit. */
export function formatMoney(value: number | undefined, currency: string): string {
  return isFigure(value) ? `${moneyFigure(value, currency)} ${currency}` : ABSENT_CELL
}

/** `formatMoney` led by the direction of a gain or loss (`▲ 1.234 VND`, `▼ -52,30 USD`); one that
 *  rounds to zero carries no sign and no arrow. */
export function formatSignedMoney(value: number | undefined, currency: string): string {
  if (!isFigure(value)) {
    return ABSENT_CELL
  }

  return `${withArrow(value, (shown) => moneyFigure(shown, currency))} ${currency}`
}

/** The direction a money amount reads in, judged off its rendered text. */
export function toneOfMoney(value: number | undefined, currency: string): Tone {
  return isFigure(value) ? toneOf(value, moneyFigure(value, currency)) : 'flat'
}

/** A figure at every digit it was recorded with, up to a satoshi: what a reader checks against a
 *  broker slip, so nothing rounds. */
export function formatExactAmount(value: number | undefined): string {
  return formatQuantity(value)
}

/** Money as recorded: every digit, then the currency's code. */
export function formatRecordedMoney(value: number | undefined, currency: string): string {
  return isFigure(value) ? `${formatExactAmount(value)} ${currency}` : ABSENT_CELL
}

/** A money total at a glance in the page's language (`76,5 tỷ`, `1.2 trillion`), with no currency; a missing
 *  one prints `ABSENT_CELL`. */
export function formatCompactAmount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return ABSENT_CELL
  }

  return sharedFormatter('compact').format(value)
}

/** As `formatCompactAmount`, led by the direction of a net figure: `▲ 310 tỷ`, `▼ -520 tỷ`; zero
 *  carries no mark. */
export function formatSignedCompactAmount(value: number | undefined): string {
  return withArrow(value, formatCompactAmount)
}

/** A whole number in the page's language: a count of names, a board's divisor. */
export function formatCount(value: number | undefined): string {
  return isFigure(value) ? printed(formatterFor(0), value) : ABSENT_CELL
}

/** A price as its market prints it (`/v1/markets`): on the board's scale when it has one, else at
 *  its currency's precision, and four significant digits under one unit. A price with no known
 *  convention, as an index level, prints two decimals. Fixed either way, because a price is read in
 *  a stack. */
export function formatPrice(value: number | undefined, format: PriceFormat | undefined): string {
  if (!isFigure(value)) {
    return ABSENT_CELL
  }

  if (format === undefined) {
    return formatFixedAmount(value)
  }

  if ('currency' in format) {
    return formatCurrencyPrice(value, format.currency)
  }

  return printed(formatterFor(format.decimals), value / format.divisor)
}

/** A percent-valued field without its sign: `5,80%`, a distance either way. */
export function formatPercent(value: number | undefined): string {
  return readPercent(value === undefined ? undefined : Math.abs(value)).text
}

/** A percent-valued field (`changePct`) as `▲ 1,31%` or `▼ -0,49%`; one that rounds to zero
 *  carries no sign and no arrow. */
export function formatSignedPercent(value: number | undefined): string {
  return withArrow(value, (shown) => `${shown < 0 ? '-' : ''}${readPercent(shown).text}`)
}

/** As `formatSignedPercent`, for a field given as a fraction (`returnPct`, `0.05` is 5%). */
export function formatSignedFraction(fraction: number | undefined): string {
  return formatSignedPercent(fraction === undefined ? undefined : fraction * PERCENT)
}

/** As `toneOfPercent`, for a field given as a fraction. */
export function toneOfFraction(fraction: number | undefined): Tone {
  return toneOfPercent(fraction === undefined ? undefined : fraction * PERCENT)
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

  return { text, tone: toneOf(value, text) }
}

function isFigure(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value)
}

/** The arrow and the colour read off the rendered text, not the raw value: a move too small to
 *  survive its rounding prints as zero, and a mark beside it would claim a direction the number no
 *  longer shows. */
function toneOf(value: number, text: string): Tone {
  if (!hasMagnitude(text)) {
    return 'flat'
  }

  return value > 0 ? 'up' : 'down'
}

/** `render(value)` led by its arrow; a value that rounds away prints as an unsigned zero, an absent
 *  one as `ABSENT_CELL`. */
function withArrow(value: number | undefined, render: (value: number) => string): string {
  if (!isFigure(value)) {
    return ABSENT_CELL
  }

  const tone = toneOf(value, render(value))

  if (tone === 'flat') {
    return render(0)
  }

  return `${tone === 'up' ? UP_GLYPH : DOWN_GLYPH} ${render(value)}`
}

function moneyFigure(value: number, currency: string): string {
  return isSubUnit(value) && !isIsoCurrency(currency)
    ? formatAmount(value)
    : printed(formatterFor(minorUnitsOf(currency)), value)
}

function formatFixedAmount(value: number): string {
  return printed(sharedFormatter(isSubUnit(value) ? 'subUnitFixed' : 'amountFixed'), value)
}

function formatCurrencyPrice(value: number, currency: string): string {
  return isSubUnit(value)
    ? formatFixedAmount(value)
    : printed(formatterFor(priceDecimals(value, currency)), value)
}

/** `Intl` keeps the sign of a value that rounds away (`-0,00`), and no move happened. */
function printed(formatter: Intl.NumberFormat, value: number): string {
  const text = formatter.format(value)

  return hasMagnitude(text) ? text : formatter.format(0)
}

// A quantity in a list keeps two decimals, and more under 1 so it never reads as zero.
function listedDigits(value: number): number {
  const magnitude = Math.abs(value)

  if (magnitude === 0 || magnitude >= 1) {
    return FRACTION_DIGITS
  }

  const leadingZeros = Math.floor(-Math.log10(magnitude))

  return Math.min(LISTED_DIGITS_MAX, leadingZeros + LISTED_EXTRA_DIGITS)
}

function formatterFor(digits: number): Intl.NumberFormat {
  return buildFormatter(`fixed:${digits}`, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function sharedFormatter(name: keyof typeof NUMBER_FORMATS): Intl.NumberFormat {
  return buildFormatter(name, NUMBER_FORMATS[name])
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

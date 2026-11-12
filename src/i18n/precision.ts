// The precision rules money and prices print by, shared by the trading renderer and the page so one
// figure never reads two ways. Pure and locale-free: the callers own the `Intl` formatters.

/** Decimals of an amount, a percent or a currency with no declared minor unit. */
export const FRACTION_DIGITS = 2
/** Every digit the operator could have stated, which crypto quotes to eight. */
export const CRYPTO_SUBUNIT_DIGITS = 8
export const SUB_UNIT_SIGNIFICANT_DIGITS = 4
/** Where a value stops being quoted in decimal places and starts being quoted in significant ones. */
const SUB_UNIT_FLOOR = 1
/** Whether a rendered number carries any magnitude at all, once its own rounding has been applied. */
const SIGNIFICANT_DIGIT_RE = /[1-9]/

/** One option set per unit the trading surface and the page print. Naming them apart is what keeps
 *  a 40% target from rendering as 0.4%, and a factor score from losing the sign that carries its
 *  direction. */
export const NUMBER_FORMATS = {
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
} as const satisfies Record<string, Intl.NumberFormatOptions>

/** Whether a rendered number still carries a magnitude, or rounded away to zero at this quantity's
 *  precision. The one owner of that question: a direction read off the raw value instead asserts a
 *  move the number beside it no longer shows. */
export function hasMagnitude(text: string): boolean {
  return SIGNIFICANT_DIGIT_RE.test(text)
}

/** ISO 4217 as the runtime itself knows it. Asked rather than tabulated, and asked by membership
 *  rather than by code length: `Intl` accepts any well-formed three-letter code and reports two
 *  decimals for it, so `BTC` is indistinguishable from `USD` by shape alone. Anything absent here
 *  is a settlement token with no minor-unit table of its own. */
const ISO_CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'))

// Bounded by the currencies the markets and the book name, so it needs no eviction.
const minorUnits = new Map<string, number>()

export function isIsoCurrency(currency: string): boolean {
  return ISO_CURRENCIES.has(currency)
}

/** How many decimals a currency actually has. VND, JPY and KRW have none, and printing two states a
 *  denomination that does not exist. Asked of `Intl` rather than tabulated here, so an ISO currency
 *  the system has never seen still prints correctly. */
export function minorUnitsOf(currency: string): number {
  const cached = minorUnits.get(currency)

  if (cached !== undefined) {
    return cached
  }

  const resolved = isIsoCurrency(currency) ? isoMinorUnits(currency) : FRACTION_DIGITS

  minorUnits.set(currency, resolved)

  return resolved
}

/** `Intl` throws `RangeError` at construction for a code outside ISO 4217, so the lookup can only
 *  be reached for one it knows. */
function isoMinorUnits(currency: string): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? FRACTION_DIGITS
  )
}

/** Whether the value is small enough that decimal places stop carrying it and significant digits
 *  take over: `Intl` reports two decimals for `BTC` and `XAU`, which are not ISO currencies, and a
 *  coin trading at 0.00002 needs every digit after the point. */
export function isSubUnit(value: number): boolean {
  return value !== 0 && Math.abs(value) < SUB_UNIT_FLOOR
}

/** The decimals a price of one unit or more prints at. A token with no minor units of its own keeps
 *  the significant digits a sub-unit price prints, so a coin at 2,067 is not cut to 2,07 under its
 *  own tick. */
export function priceDecimals(value: number, currency: string): number {
  const minor = minorUnitsOf(currency)

  // `!(x >= 1)` so a zero or NaN keeps the minor units rather than asking `Intl` for infinite digits.
  if (isIsoCurrency(currency) || !(Math.abs(value) >= 1)) {
    return minor
  }

  const wholeDigits = Math.floor(Math.log10(Math.abs(value))) + 1

  return Math.max(minor, SUB_UNIT_SIGNIFICANT_DIGITS - wholeDigits)
}

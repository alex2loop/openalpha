import type { Locale } from '@/core/types/locale'
import type { CurrencyCode, MarketRef, PriceDisplay, QuoteUnit } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import {
  formatAmount,
  formatCount,
  formatExactAmount,
  formatFixedAmount,
  formatFlow,
  isSubUnit,
  renderDeclaredValue,
  withGlyph,
} from '@/trading/render/format'
import {
  FRACTION_DIGITS,
  formatFixedDigits,
  SUB_UNIT_SIGNIFICANT_DIGITS,
} from '@/trading/render/number'

/** ISO 4217 as the runtime itself knows it. Asked rather than tabulated, and asked by membership
 *  rather than by code length: `Intl` accepts any well-formed three-letter code and reports two
 *  decimals for it, so `BTC` is indistinguishable from `USD` by shape alone. Anything absent here
 *  is a settlement token with no minor-unit table of its own. */
const ISO_CURRENCIES: ReadonlySet<string> = new Set(Intl.supportedValuesOf('currency'))

/** A divisor above 1 means prices render in board points rather than currency units, so the currency
 *  name would mislabel them and a "whole units, not board price" warning has something to warn
 *  about. Crypto and gold declare no divisor and read in their own currency throughout. */
export function isBoardScaled(display?: PriceDisplay): boolean {
  return display !== undefined && display.divisor > 1
}

/** A price as the venue's board shows it. Falls back to the plain amount when the market declares no
 *  board convention — fixed either way, because a price is read in a stack and a trimmed trailing
 *  zero puts the decimal point in a different place on the row below. */
export function formatPrice(locale: Locale, value: number, display?: PriceDisplay): string {
  return display === undefined
    ? formatFixedAmount(locale, value)
    : boardPrice(locale, value, display)
}

function boardPrice(locale: Locale, value: number, display: PriceDisplay): string {
  return formatFixedDigits(locale, value / display.divisor, display.decimals)
}

// Bounded by the registered markets' currencies, so it needs no eviction.
const minorUnits = new Map<string, number>()

/** How many decimals a currency actually has. VND, JPY and KRW have none, and printing two states a
 *  denomination that does not exist. Asked of `Intl` rather than tabulated here, so an ISO currency
 *  the system has never seen still prints correctly. */
export function minorUnitsOf(currency: CurrencyCode): number {
  const cached = minorUnits.get(currency)

  if (cached !== undefined) {
    return cached
  }

  const resolved = ISO_CURRENCIES.has(currency) ? isoMinorUnits(currency) : FRACTION_DIGITS

  minorUnits.set(currency, resolved)

  return resolved
}

/** `Intl` throws `RangeError` at construction for a code outside ISO 4217, so the lookup can only
 *  be reached for one it knows. */
function isoMinorUnits(currency: CurrencyCode): number {
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? FRACTION_DIGITS
  )
}

/** Money with its own currency's precision, then the ISO code. The code rather than `Intl`'s symbol:
 *  `₫` and `US$` in one document read as decoration, while the code is what a broker slip carries.
 *
 *  Significant digits take over below one unit only for a token with no minor units of its own,
 *  where a balance of 0.00002 is a real holding. A currency that declares its own precision is the
 *  authority on what it can express, and an amount under that is zero rather than a figure needing
 *  more digits: a realised P/L of 1,455e-11 printed fourteen decimals and an up arrow in a USD
 *  book, and rounded away unseen in a đồng one. A price is the other question and keeps every
 *  digit either way — see `formatFixedPrice`. */
export function formatMoney(locale: Locale, value: number, currency: CurrencyCode): string {
  return isSubUnit(value) && !ISO_CURRENCIES.has(currency)
    ? `${formatAmount(locale, value)} ${currency}`
    : `${formatFixedDigits(locale, value, minorUnitsOf(currency))} ${currency}`
}

/** An amount for an error message, which is worded later in the reader's locale: the currency's
 *  own precision travels with it, and the copy names the currency. */
export function moneyParam(
  value: number,
  currency: CurrencyCode
): { readonly amount: number; readonly digits: number } {
  return { amount: value, digits: minorUnitsOf(currency) }
}

/** How a market prints the price of one unit: what it quotes in, the measure the price is per, and
 *  its board convention where it declares one. Resolved once per market by whoever can reach the
 *  registry, because a renderer cannot. */
export interface QuoteConvention {
  readonly currency: CurrencyCode
  readonly unit: QuoteUnit
  readonly display?: PriceDisplay
}

/** A price and the convention it prints in. The currency is its own field rather than the market's,
 *  because a holding is quoted in the currency it was bought in and only the holder knows that. */
export interface QuotedIn {
  readonly currency: CurrencyCode
  readonly unit?: QuoteUnit
  readonly display?: PriceDisplay
}

/** The convention's optional halves, ready to spread into a `QuotedIn` — or nothing at all when
 *  the registry had no convention for that market. `exactOptionalPropertyTypes` rejects forwarding
 *  an optional field any other way, and every price-bearing surface needs the same two. */
export function quotedInOf(convention?: QuoteConvention): Pick<QuotedIn, 'unit' | 'display'> {
  if (convention === undefined) {
    return {}
  }

  return {
    unit: convention.unit,
    ...(convention.display === undefined ? {} : { display: convention.display }),
  }
}

/** Units the instrument already implies: a share price is per share and a coin price per coin, so
 *  naming it states the mechanism rather than the fact. Anything else is a measure the ticker does
 *  not carry — the same gold reading is one number per lượng and another per ounce — and is spelled
 *  out beside the price. Listing what is implied rather than what is spelled means a market
 *  quoting a new measure is labelled without an edit here. */
const IMPLIED_UNITS: ReadonlySet<string> = new Set(['currency-per-share', 'currency-per-coin'])

/** What one unit costs, in the convention its own venue quotes. The currency is taken separately
 *  from the unit because a holding is quoted in the currency it was bought in, which the market's
 *  own convention cannot know. */
export function formatQuotedPrice(locale: Locale, value: number, quote: QuotedIn): string {
  return labelled(locale, quotedAmount(locale, value, quote), quote)
}

function quotedAmount(locale: Locale, value: number, quote: QuotedIn): string {
  return quote.display === undefined
    ? formatFixedPrice(locale, value, quote.currency)
    : boardPrice(locale, value, quote.display)
}

/** A price at the precision its own currency actually has, with no code appended — the caller states
 *  the unit. `formatPrice` cannot ask that question because it also renders index levels, which no
 *  currency denominates, so the two decimals it falls back to printed đồng as `143.500.000,00`, a
 *  denomination VND does not have. Fixed above one unit, because a price is read in a stack. */
export function formatFixedPrice(locale: Locale, value: number, currency: CurrencyCode): string {
  return isSubUnit(value)
    ? formatFixedAmount(locale, value)
    : formatFixedDigits(locale, value, priceDecimals(value, currency))
}

/** A token with no minor units of its own keeps the significant digits a sub-unit price prints, so a
 *  coin at 2,067 is not cut to 2,07 under its own tick. */
function priceDecimals(value: number, currency: CurrencyCode): number {
  const minor = minorUnitsOf(currency)

  // `!(x >= 1)` so a zero or NaN keeps the minor units rather than asking `Intl` for infinite digits.
  if (ISO_CURRENCIES.has(currency) || !(Math.abs(value) >= 1)) {
    return minor
  }

  const wholeDigits = Math.floor(Math.log10(Math.abs(value))) + 1

  return Math.max(minor, SUB_UNIT_SIGNIFICANT_DIGITS - wholeDigits)
}

/** A recorded price may name the instrument it is per; a declared unit already says what one is. */
interface RecordedQuote extends QuotedIn {
  readonly ticker?: string
}

/** The same price where the reader is checking it against a fill rather than reading a board: a
 *  recorded row prints every digit it holds. A board-scaled market keeps its board form, which is
 *  the scale the operator stated the price in. */
export function formatRecordedPrice(locale: Locale, value: number, quote: RecordedQuote): string {
  const price =
    quote.display === undefined
      ? formatExactAmount(locale, value)
      : boardPrice(locale, value, quote.display)
  const text = labelled(locale, price, quote)

  return quote.ticker === undefined || namesUnit(quote.unit) ? text : `${text}/${quote.ticker}`
}

/** Money on the same surface, for the same reason: a fee is checked against what the venue billed. */
export function formatRecordedMoney(locale: Locale, value: number, currency: CurrencyCode): string {
  return `${formatExactAmount(locale, value)} ${currency}`
}

/** A board-scaled price carries no currency code: labelling board points as đồng is exactly the
 *  misreading the convention prevents, and `isBoardScaled` is where that rule already lives. */
function labelled(locale: Locale, price: string, quote: QuotedIn): string {
  return isBoardScaled(quote.display)
    ? price
    : `${price} ${quotedIn(locale, quote.currency, quote.unit)}`
}

/** A compact magnitude with the money it is in — a market cap or a turnover, where the digits are
 *  abbreviated and no label above the row says which currency they count. Bare when the surface
 *  does not know: a VND market cap and a USD one are the same digits otherwise. */
export function formatFlowIn(locale: Locale, value: number, currency?: CurrencyCode): string {
  return currency === undefined
    ? formatFlow(locale, value)
    : `${formatFlow(locale, value)} ${currency}`
}

/** The same price where the surface may know none of the convention, some of it, or all: a level
 *  under a market the registry no longer lists prints bare, a board-scaled one prints in points,
 *  and a quoted one carries its currency and measure. One branch, so no surface re-derives it. */
export function formatPriceIn(
  locale: Locale,
  value: number,
  quote: Partial<QuotedIn> = {}
): string {
  const { currency } = quote

  if (currency === undefined) {
    return formatPrice(locale, value, quote.display)
  }

  return formatQuotedPrice(locale, value, { ...quote, currency })
}

/** The same price for a reader with no board note above it: a board-scaled one states its scale
 *  beside the number, so `43,00` is never read as 43 đồng. */
export function formatScaledPrice(
  locale: Locale,
  value: number,
  quote: Partial<QuotedIn> = {}
): string {
  const price = formatPriceIn(locale, value, quote)
  const { currency, display } = quote

  return currency !== undefined && display !== undefined && isBoardScaled(display)
    ? `${price} (${renderBoardScale(locale, display, currency)})`
    : price
}

export function renderBoardScale(
  locale: Locale,
  display: PriceDisplay,
  currency: CurrencyCode
): string {
  return t(locale, 'trading.quote-unit.board', {
    divisor: formatCount(locale, display.divisor),
    currency,
  })
}

function quotedIn(locale: Locale, currency: CurrencyCode, unit?: QuoteUnit): string {
  return namesUnit(unit)
    ? renderDeclaredValue(locale, `trading.quote-unit.${unit}`, { currency })
    : currency
}

function namesUnit(unit: QuoteUnit | undefined): unit is QuoteUnit {
  return unit !== undefined && !IMPLIED_UNITS.has(unit)
}

export function formatSignedMoney(locale: Locale, value: number, currency: CurrencyCode): string {
  return withGlyph(value, (magnitude) => formatMoney(locale, magnitude, currency))
}

const MARKET_SEPARATOR = ', '

/** A quote as a board note needs to see it: which market set the convention, and what that market
 *  quotes in. */
export interface BoardQuoted {
  readonly market: MarketRef
  readonly currency?: CurrencyCode
  readonly display?: PriceDisplay
}

/** Which rows on a board are quoted in points rather than money, said once beneath them.
 *  `formatQuotedPrice` drops the currency from a board price because naming one would mislabel the
 *  number, which leaves a list with no way to say what scale it is in — `/price` explains itself,
 *  a list cannot afford to do so per row. Grouped by convention, not by market, so the common case
 *  of one board is one line however many names sit under it. */
export function renderBoardScaleNotes(
  locale: Locale,
  quotes: readonly BoardQuoted[]
): readonly string[] {
  const byConvention = new Map<string, { markets: Set<MarketRef>; note: BoardQuoted }>()

  for (const quote of quotes) {
    if (quote.currency === undefined || !isBoardScaled(quote.display)) {
      continue
    }

    const key = `${quote.display?.divisor}:${quote.currency}`
    const entry = byConvention.get(key) ?? { markets: new Set<MarketRef>(), note: quote }

    entry.markets.add(quote.market)
    byConvention.set(key, entry)
  }

  return [...byConvention.values()].map((entry) =>
    t(locale, 'trading.render.boardScale', {
      markets: [...entry.markets]
        .map((market) => renderDeclaredValue(locale, `trading.market.${market}`))
        .join(MARKET_SEPARATOR),
      divisor: formatCount(locale, entry.note.display?.divisor ?? 1),
      currency: entry.note.currency ?? '',
    })
  )
}

import { z } from 'zod'

import type { CommandMessage, CommandMessageKey, SlashResult } from '@/core/types/command'
import type {
  InstrumentKind,
  InstrumentRef,
  MarketRef,
  Region,
  ScreenableKinds,
  Ticker,
  TickerRequest,
  TradingDay,
  VenueRef,
  VenueTickerRequest,
} from '@/trading/kernel/instrument'
import type { AlertId } from '@/trading/kernel/operator/alert'
import type { LedgerEntryId } from '@/trading/kernel/operator/book'
import { definedOnly } from '@/core/utils/collections'
import { isWord } from '@/core/utils/text'
import {
  marketRef,
  region,
  screenableKindList,
  screenableKindsText,
  ticker,
  tradingDay,
  VN_GOLD_FORMS,
  venueRef,
} from '@/trading/kernel/instrument'
import { alertId } from '@/trading/kernel/operator/alert'
import { ledgerEntryId } from '@/trading/kernel/operator/book'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

const PERCENT_SIGN = '%'
const PERCENT_PER_UNIT = 100
/** Plain decimal only: `Number()` alone reads `0x10` as 16 and `1e3` as 1000. */
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/

/** Set by the surfaces where the operator types a price: `unconfirmed` refuses one far from the
 *  market with `PriceUnconfirmedError`, `confirmed` writes it as typed. Unset is never checked: a
 *  writer holding a venue's figure, or a client that never asks. */
export const TYPED_PRICES = Object.freeze(['unconfirmed', 'confirmed'] as const)
export type TypedPrice = (typeof TYPED_PRICES)[number]

/** Direct slash syntax is closed: every parser returns `null` rather than guessing, and the command
 *  answers with its own usage key. No parser supplies a business default. */
export function parseBranded<T>(raw: string | undefined, brand: (value: string) => T): T | null {
  if (raw === undefined) {
    return null
  }

  try {
    return brand(raw)
  } catch {
    return null
  }
}

export function parseMember<T extends string>(
  raw: string | undefined,
  members: readonly T[]
): T | null {
  return members.find((member) => isWord(raw, member)) ?? null
}

export function parseFiniteNumber(raw: string | undefined): number | null {
  if (raw === undefined || !DECIMAL_RE.test(raw.trim())) {
    return null
  }

  const value = Number(raw)

  return Number.isFinite(value) ? value : null
}

/** A share written `0.2` or `20%`, returned as the fraction `0.2`. A space before the sign, a comma
 *  decimal and a bare `%` read as nothing, so `20 %` is never taken for 20 nor `20,5%` for 205. Range
 *  is the validator's. */
export function parseFraction(raw: string | undefined): number | null {
  if (raw === undefined || !raw.endsWith(PERCENT_SIGN)) {
    return parseFiniteNumber(raw)
  }

  const body = raw.slice(0, -PERCENT_SIGN.length)
  const percent = body === body.trim() ? parseFiniteNumber(body) : null

  return percent === null ? null : percent / PERCENT_PER_UNIT
}

export function parsePositiveInteger(raw: string | undefined, maximum: number): number | null {
  const value = parseFiniteNumber(raw)

  if (value === null || !Number.isInteger(value) || value <= 0 || value > maximum) {
    return null
  }

  return value
}

/** A market typed at a command line is a lookup key, and the registry the service holds is the only
 *  authority on membership — so an unregistered one earns the usage line, which names the markets
 *  that do exist, rather than a lookup miss thrown from three layers down. An omitted market is `null` here; a caller for which that is legal says so itself. */
export function parseRegisteredMarket(
  raw: string | undefined,
  registered: readonly MarketRef[]
): MarketRef | null {
  const market = parseBranded(raw, marketRef)

  return market !== null && registered.includes(market) ? market : null
}

/** How many names one command line may carry. A parse bound, not a storage bound: the profile has
 *  its own ceiling on what may be *saved*, and the two are equal only by coincidence today. */
const MAXIMUM_PARSED_TICKERS = 100
/** `scope:ticker` qualifies a name several scopes could claim — a market for a read, a venue for an
 *  order. One token, so it composes with a variadic list where a positional slot cannot: a trailing
 *  word is always a well-formed ticker. Composition refuses a venue id that is also a market id, so
 *  a scope reads exactly one way. */
const SCOPE_QUALIFIER = ':'

/** The whole settled position, in the quantity slot a count would occupy. Kernel vocabulary because
 *  `/record` reads it and an exit alert writes it into the line it suggests. */
export const SELL_ALL = 'all'

interface ScopedTicker {
  readonly symbol: Ticker
  /** Raw, because which registry qualifies it is the caller's question, not this split's. */
  readonly scope?: string
}

/** The one place the qualifier is split, so the three parsers below cannot disagree about it. A
 *  ticker admits no colon, so a second one fails the brand rather than silently taking a half. */
function splitScopedTicker(raw: string | undefined): ScopedTicker | null {
  if (raw === undefined) {
    return null
  }

  const qualifier = raw.indexOf(SCOPE_QUALIFIER)
  const symbol = parseBranded(qualifier < 0 ? raw : raw.slice(qualifier + 1), ticker)

  if (symbol === null) {
    return null
  }

  return { symbol, ...(qualifier < 0 ? {} : { scope: raw.slice(0, qualifier) }) }
}

export function parseTickerRequest(
  raw: string | undefined,
  registered: readonly MarketRef[]
): TickerRequest | null {
  const scoped = splitScopedTicker(raw)

  if (scoped === null) {
    return null
  }

  if (scoped.scope === undefined) {
    return { ticker: scoped.symbol }
  }

  const market = parseRegisteredMarket(scoped.scope, registered)

  return market === null ? null : { ticker: scoped.symbol, market }
}

/** `[venue:]ticker`. The venue is brand-checked and not looked up: routing owns which venues could
 *  serve the order and refuses with the candidates named, which a parser cannot do. */
export function parseVenueTickerRequest(raw: string | undefined): VenueTickerRequest | null {
  const scoped = splitScopedTicker(raw)

  if (scoped === null) {
    return null
  }

  if (scoped.scope === undefined) {
    return { ticker: scoped.symbol }
  }

  const venue = parseBranded(scoped.scope, venueRef)

  return venue === null ? null : { ticker: scoped.symbol, venue }
}

/** `market:ticker` with the market required: a ledger row states the market it books against rather
 *  than resolving one, because the row re-bases every reading taken from the book. `/record` alone
 *  may drop the market, and only after `ledger/shorthand.ts` has settled it from the stored lists
 *  and written it back in. Brands only - `ledger/validate.ts` owns membership, which keeps this
 *  parser pure and config-free. */
export function parseQualifiedInstrument(raw: string | undefined): InstrumentRef | null {
  const scoped = splitScopedTicker(raw)

  if (scoped === null || scoped.scope === undefined) {
    return null
  }

  const market = parseBranded(scoped.scope, marketRef)

  return market === null ? null : { market, ticker: scoped.symbol }
}

/** All or nothing, like every other parser here: one unparseable name earns the usage line rather
 *  than a silently shortened list. */
export function parseTickers(
  raw: readonly string[],
  registered: readonly MarketRef[]
): readonly TickerRequest[] | null {
  if (raw.length === 0 || raw.length > MAXIMUM_PARSED_TICKERS) {
    return null
  }

  const parsed: TickerRequest[] = []

  for (const entry of raw) {
    const request = parseTickerRequest(entry, registered)

    if (request === null) {
      return null
    }

    parsed.push(request)
  }

  return parsed
}

export function usage(key: CommandMessageKey, values?: CommandMessage['values']): SlashResult {
  return { kind: 'message', messages: [{ key, ...(values === undefined ? {} : { values }) }] }
}

const GOLD_FORM_TICKERS = VN_GOLD_FORMS.map((form) => form.toUpperCase()).join(', ')

/** A market schema is the branded market ref built from the registered set. */
export type MarketSchema = z.ZodType<MarketRef>
/** A region schema is the branded region built from the registered set. */
export type RegionSchema = z.ZodType<Region>

/** A portfolio read is always as things stand — a caller-chosen day could backdate a suggestion. */
export const noInput = z.strictObject({})

/** Every price a tool takes is stored as typed, in whole units of the quoting currency. Replies
 *  write a board-scaled price with its scale, so the conversion is stated where the model types. */
export const PRICE_INPUT_UNITS =
  'In whole currency units, never board points: a VN share shown as 43,00 (x1.000 VND) is 43000.'

export const newsLimit = z
  .int()
  .positive()
  .max(SURFACE_LIMITS.maximumNewsItems)
  .optional()
  .describe(`Headlines to return, newest first, up to ${SURFACE_LIMITS.maximumNewsItems}.`)

/** Turns a brand constructor's throw into a Zod issue, so the brand functions stay the single
 *  source of each invariant and no surface restates their patterns. */
function branded<T>(parse: (raw: string) => T, label: string): z.ZodType<T> {
  return z.string().transform((raw, ctx) => {
    try {
      return parse(raw)
    } catch {
      ctx.addIssue({ code: 'custom', message: `invalid ${label}` })
      return z.NEVER
    }
  })
}

// Each brand narrows a plain string, so the schema a model receives is `type: "string"` and nothing
// more. Without these, a caller asked for FPT sends the exchange it actually lists on — `HOSE` —
// and gets "invalid market" with no statement of what a market even is.
export const tickerInput: z.ZodType<Ticker> = branded(ticker, 'ticker').describe(
  `Instrument symbol alone, such as FPT, BTC, XAU, or SJC. No exchange prefix or suffix. For a named gold form use ${GOLD_FORM_TICKERS}; bare SJC quotes whichever form is cheapest to hold.`
)
/** A factory for the same reason as `regionInput`: naming the registered set is what stops a model
 *  guessing `vietnam` for a required market and abandoning the tool when the guess is rejected. */
export function marketInput(markets: readonly MarketRef[]): z.ZodType<MarketRef> {
  return branded(marketRef, 'market').describe(
    `Registered market ref, one of: ${markets.join(', ')}. Never an exchange code like HOSE.`
  )
}

/** A factory, not a constant: the registered set is registry state, and a hand-written list aimed at
 *  a model goes stale silently — the failure is a model that never asks for a market nobody told it
 *  exists. Naming the valid set is also what stops it guessing, since an unregistered region is
 *  rejected downstream. */
export function regionInput(regions: readonly Region[]): z.ZodType<Region> {
  return branded(region, 'region').describe(`Region slug. Registered: ${regions.join(', ')}.`)
}

/** A constant, not a factory: the set worth naming is the venues holding *this row's* market, which
 *  the schema cannot know. A refusal states them instead. */
export const venueInput: z.ZodType<VenueRef> = branded(venueRef, 'venue').describe(
  'Custodian holding the instrument - a broker or exchange id. Omit it unless the operator named one; the ledger fills the custodian its market resolves to and refuses with the candidates when more than one could hold it.'
)

interface ScreenInputScope {
  readonly markets: MarketSchema
  readonly screenableKinds: ScreenableKinds
}

interface ScreenToolInput {
  readonly market: MarketRef
  readonly limit?: number
  readonly instrumentKind?: InstrumentKind
}

/** A third registry-derived input, for the same reason as the two above — plus a rule no JSON
 *  Schema can carry: which kinds exist is per market, so the pair is checked rather than described.
 *  Described alone, a model narrows a market that does not list the kind and reads the empty board
 *  back as the market's verdict. */
export function screenInput(scope: ScreenInputScope): z.ZodType<ScreenToolInput> {
  const base = {
    market: scope.markets,
    limit: z
      .int()
      .positive()
      .max(SURFACE_LIMITS.maximumScreenCandidates)
      .optional()
      .describe(
        `How many names to rank, up to ${SURFACE_LIMITS.maximumScreenCandidates}. Omit for the default board.`
      ),
  }
  const [first, ...rest] = screenableKindList(scope.screenableKinds)

  // No registered market screens by kind, so there is nothing to offer and nothing to check.
  if (first === undefined) {
    return z.strictObject(base).transform((value) => definedOnly(value))
  }

  const offered = screenableKindsText(scope.screenableKinds)

  return z
    .strictObject({
      ...base,
      instrumentKind: z
        .enum([first, ...rest])
        .optional()
        .describe(instrumentKindDescription(offered)),
    })
    .superRefine((value, ctx) => {
      const kind = value.instrumentKind

      if (kind === undefined || scope.screenableKinds.get(value.market)?.includes(kind)) {
        return
      }

      ctx.addIssue({
        code: 'custom',
        path: ['instrumentKind'],
        message: `${value.market} lists no ${kind} instruments. Kinds by market: ${offered}. Call again without instrumentKind.`,
      })
    })
    .transform((value) => definedOnly(value))
}

function instrumentKindDescription(offered: string): string {
  return `Omit this unless the operator asked for one slice of a market. Which instrument kinds a market lists: ${offered}; naming a kind the chosen market does not list is refused. Where a market holds more than one, "etf" is the narrowing worth making: unfiltered, a handful of ETFs is out-ranked by hundreds of stocks in one merged ranking.`
}

export const dayInput: z.ZodType<TradingDay> = branded(tradingDay, 'trading day').describe(
  'Calendar day as YYYY-MM-DD.'
)
export const alertIdInput: z.ZodType<AlertId> = branded(alertId, 'alert id').describe(
  'Alert id as returned by alert_manage list or create.'
)

export const priceConfirmedInput = z
  .literal(true)
  .optional()
  .describe(
    'True only after the operator confirmed a price the tool refused as far from the market. Omit otherwise.'
  )

export function toTypedPrice(priceConfirmed: true | undefined): TypedPrice {
  return priceConfirmed === true ? 'confirmed' : 'unconfirmed'
}

export const ledgerEntryIdInput: z.ZodType<LedgerEntryId> = branded(
  ledgerEntryId,
  'event id'
).describe('Ledger row id as returned by portfolio_history or a write receipt.')
export const dayRangeInput = z.strictObject({
  fromDay: dayInput.describe('First calendar day of the window, YYYY-MM-DD.'),
  toDay: dayInput.describe('Last calendar day of the window, YYYY-MM-DD, on or after fromDay.'),
})

/** Ticker with an optional market: omit it when only one market can claim the ticker. That rule
 *  holds only where a ticker field exists, so it is described here rather than on every market a
 *  tool requires. Describing the optional replaces the base description outright, so the registered
 *  set is carried over rather than restated — this factory holds the schema, never the list. */
export function instrumentQueryInput(markets: MarketSchema): {
  ticker: typeof tickerInput
  market: z.ZodOptional<MarketSchema>
} {
  // A schema carries no description by type, and a template literal would render that absence as
  // the word "undefined" in text a model reads as instruction.
  const registered = markets.description === undefined ? '' : `${markets.description} `
  const market = markets
    .optional()
    .describe(
      `${registered}Omitting it lets the ticker resolve on its own; supply one only when two markets could claim the same ticker.`
    )

  return { ticker: tickerInput, market }
}

import type { CommandMessage, CommandMessageKey } from '@/core/types/command'
import type { MarketDataService } from '@/trading/features/market-data/types'
import type { MarketRef, Region, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { MarketRegistry } from '@/trading/markets/types'
import type { VenueRegistry } from '@/trading/venues/types'
import { SELL_ALL } from '@/trading/features/ledger/types'
import { resolveRegionDay } from '@/trading/features/market-data/resolve'
import { currencyCode, tradingDay, venueRef } from '@/trading/kernel/instrument'
import { parseBranded, parseTickerRequest } from '@/trading/kernel/surface/surface'

/** Every refusal the shorthand can answer, for the command's `messageKeys`. */
export const SHORTHAND_KEYS = Object.freeze([
  'slash.tradingRecordMarketChoice',
  'slash.tradingRecordMarketUnknown',
  'slash.tradingRecordVenueChoice',
  'slash.tradingRecordNoVenue',
  'slash.tradingRecordRightsFee',
] as const satisfies readonly CommandMessageKey[])

const SHORTHAND_KINDS: readonly string[] = ['buy', 'sell', 'rights']
const FX_TOKEN = 'fx'
const FX_TOKENS = 2
const NUMBER_RE = /^\d[\d.,]*$/
const CHOICE_SEPARATOR = ', '
/** A venue and an instrument may precede the quantity; either alone is the instrument. */
const LONGEST_HEAD = 2

type ShorthandExpansion =
  | { readonly kind: 'tokens'; readonly tokens: readonly string[] }
  | { readonly kind: 'refused'; readonly messages: readonly CommandMessage[] }

interface ShorthandInput {
  readonly tokens: readonly string[]
  readonly now: number
  readonly signal: AbortSignal
}

interface ShorthandDeps {
  readonly venues: VenueRegistry
  readonly markets: MarketRegistry
  readonly defaultRegion: Region
  /** Consumer-side: all the shorthand asks of the book is who may hold a market. */
  readonly portfolio: { recordVenues(market: MarketRef): readonly VenueRef[] }
  readonly marketData: Pick<MarketDataService, 'quoteConvention'>
}

/** The pieces of a buy, sell or rights line that were typed, each recognised by its shape. */
interface TypedLine {
  readonly kind: string
  readonly venue?: VenueRef
  readonly instrument: string
  readonly quantity: string
  readonly price: string
  readonly currency?: string
  readonly fee?: string
  readonly day?: string
  readonly fx: readonly string[]
}

/** Fills what a trade line left out so `parseLedgerDraft` reads the full form it always has: the
 *  venue and market the stored lists settle, the market's currency, today. A bare ticker is looked
 *  up only in lists already stored, among markets a venue holds, and accepted only when exactly one
 *  market matches. Every other slot is told apart by its shape, never by counting arguments, and a
 *  line that fits no shape passes through for the parser's own error. */
export async function toFullRecordLine(
  deps: ShorthandDeps,
  input: ShorthandInput
): Promise<ShorthandExpansion> {
  const typed = readTypedLine(deps, input.tokens)

  if (typed === undefined) {
    return { kind: 'tokens', tokens: input.tokens }
  }

  const market = await resolveMarket(deps, typed, input.signal)

  if ('messages' in market) {
    return { kind: 'refused', messages: market.messages }
  }

  const venue = typed.venue ?? resolveVenue(deps, typed, market)

  if (typeof venue !== 'string') {
    return { kind: 'refused', messages: venue.messages }
  }

  if (typed.kind === 'rights' && typed.fee === undefined) {
    return { kind: 'refused', messages: [{ key: 'slash.tradingRecordRightsFee' }] }
  }

  const currency = typed.currency ?? deps.marketData.quoteConvention(market.ref)?.currency
  const day = typed.day ?? resolveRegionDay(deps.markets, deps.defaultRegion, input.now)

  if (currency === undefined) {
    return { kind: 'tokens', tokens: input.tokens }
  }

  const filled = { venue, market: market.ref, ticker: market.ticker, currency, day }

  return { kind: 'tokens', tokens: assemble(typed, filled) }
}

function assemble(
  typed: TypedLine,
  filled: {
    readonly venue: string
    readonly market: MarketRef
    readonly ticker: string
    readonly currency: string
    readonly day: TradingDay | string
  }
): readonly string[] {
  return [
    typed.kind,
    filled.venue,
    `${filled.market}:${filled.ticker}`,
    typed.quantity,
    typed.price,
    filled.currency,
    ...(typed.fee === undefined ? [] : [typed.fee]),
    filled.day,
    ...typed.fx,
  ]
}

function readTypedLine(deps: ShorthandDeps, tokens: readonly string[]): TypedLine | undefined {
  const [kind, ...rest] = tokens

  if (kind === undefined || !SHORTHAND_KINDS.includes(kind)) {
    return undefined
  }

  const fx =
    rest.length > FX_TOKENS && rest.at(-FX_TOKENS) === FX_TOKEN ? rest.slice(-FX_TOKENS) : []
  const body = rest.slice(0, rest.length - fx.length)
  const at = body.findIndex(isQuantityToken)
  const [quantity, price, ...tail] = body.slice(at)

  if (at < 1 || at > LONGEST_HEAD || quantity === undefined || price === undefined) {
    return undefined
  }

  const head = body.slice(0, at)
  const named = head.length === LONGEST_HEAD ? parseBranded(head[0], venueRef) : null
  const venue = named === null ? null : deps.venues.find(named)
  const instrument = head.at(-1)
  const claimed = claimTail(tail)

  if (instrument === undefined || claimed === undefined) {
    return undefined
  }

  // Two words before the quantity are a venue and an instrument; a first word no venue answers to
  // leaves the line for the parser to refuse.
  if (head.length === LONGEST_HEAD && venue === null) {
    return undefined
  }

  return {
    kind,
    ...(venue === null ? {} : { venue: venue.manifest.id }),
    instrument,
    quantity,
    price,
    ...claimed,
    fx,
  }
}

/** Currency, then fee, then day: each token takes the first of those slots it fits at or after the
 *  last one claimed, so `FPT 100 58400 2026-10-17` is a day and `... 58400 VND 0 2026-10-17` all
 *  three. Undefined when a token fits no slot left. */
function claimTail(
  tail: readonly string[]
): Pick<TypedLine, 'currency' | 'fee' | 'day'> | undefined {
  const claimed: { currency?: string; fee?: string; day?: string } = {}
  let slot = 0

  for (const token of tail) {
    const next = [isCurrency, isQuantityToken, isDay].findIndex(
      (fits, index) => index >= slot && fits(token)
    )
    const name = next === -1 ? undefined : (['currency', 'fee', 'day'] as const)[next]

    if (name === undefined) {
      return undefined
    }

    claimed[name] = token
    slot = next + 1
  }

  return claimed
}

type MarketAnswer =
  | { readonly ref: MarketRef; readonly ticker: string }
  | { readonly messages: readonly CommandMessage[] }

async function resolveMarket(
  deps: ShorthandDeps,
  typed: TypedLine,
  signal: AbortSignal
): Promise<MarketAnswer> {
  const registered = deps.markets.list().map((market) => market.manifest.id)
  const request = parseTickerRequest(typed.instrument, registered)

  if (request === null) {
    return { messages: [unknown(typed.instrument)] }
  }

  if (request.market !== undefined) {
    return { ref: request.market, ticker: request.ticker }
  }

  const named = typed.venue === undefined ? undefined : deps.venues.find(typed.venue)
  const within =
    named === undefined || named === null ? [...deps.venues.heldMarkets()] : named.manifest.markets
  const result = await deps.markets.resolve({
    ticker: request.ticker,
    within,
    detection: 'stored',
    signal,
  })

  if (result.kind === 'resolved') {
    return { ref: result.market.manifest.id, ticker: request.ticker }
  }

  if (result.kind === 'ambiguous-market') {
    const choices = result.candidates.map((market) => `${market}:${request.ticker}`)

    return {
      messages: [
        {
          key: 'slash.tradingRecordMarketChoice',
          values: { ticker: request.ticker, choices: choices.join(CHOICE_SEPARATOR) },
        },
      ],
    }
  }

  return { messages: [unknown(request.ticker)] }
}

function resolveVenue(
  deps: ShorthandDeps,
  typed: TypedLine,
  market: { readonly ref: MarketRef; readonly ticker: string }
): string | { readonly messages: readonly CommandMessage[] } {
  const resolved = resolveRecordVenue(deps.portfolio.recordVenues(market.ref))

  if (resolved.kind === 'sole') {
    return resolved.venue
  }

  if (resolved.kind === 'none') {
    return {
      messages: [
        {
          key: 'slash.tradingRecordNoVenue',
          values: { market: { key: `trading.market.${market.ref}` } },
        },
      ],
    }
  }

  const [first = ''] = resolved.venues
  const example = `/record ${typed.kind} ${first} ${market.ref}:${market.ticker} ${typed.quantity} ${typed.price}`

  return {
    messages: [
      {
        key: 'slash.tradingRecordVenueChoice',
        values: { venues: resolved.venues.join(CHOICE_SEPARATOR), example },
      },
    ],
  }
}

function unknown(ticker: string): CommandMessage {
  return { key: 'slash.tradingRecordMarketUnknown', values: { ticker } }
}

function isQuantityToken(token: string): boolean {
  return NUMBER_RE.test(token) || token === SELL_ALL
}

function isCurrency(token: string): boolean {
  return parseBranded(token, currencyCode) !== null
}

function isDay(token: string): boolean {
  return parseBranded(token, tradingDay) !== null
}

/** The custodian a row with no venue named is booked under, or why none can be chosen: a guess
 *  would book the cost basis under the wrong one. */
type RecordVenue =
  | { readonly kind: 'sole'; readonly venue: VenueRef }
  | { readonly kind: 'none' }
  | { readonly kind: 'several'; readonly venues: readonly VenueRef[] }

export function resolveRecordVenue(candidates: readonly VenueRef[]): RecordVenue {
  const [only] = candidates

  if (candidates.length === 1 && only !== undefined) {
    return { kind: 'sole', venue: only }
  }

  return candidates.length === 0 ? { kind: 'none' } : { kind: 'several', venues: candidates }
}

import { type Signal, signal } from '@preact/signals'

import type { TradeDraft, TradeEntry, TradeKind } from '@/web/state/trade'
import type { FormFailure } from '@/web/ui/dialogs/field-errors'
import { formatDay, translateDisplayText } from '@/i18n'
import { heldPositions, priceDisplayOf, quotesBlock, watchedNames } from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { isAmbiguousGrouping, toDecimal } from '@/web/text/decimal'
import { formatPrice, formatQuantity } from '@/web/text/figures'
import { formatMarketPrice, toWholeUnits } from '@/web/text/market-price'
import { buildDayKey } from '@/web/text/time'
import { tr } from '@/web/text/tr'

// The daemon's zone is always known once the page is up; this only types the lookup.
const FALLBACK_ZONE = 'UTC'
const KEY_BYTES = 16
const DATE_SEPARATORS = /[/.\-\s]+/
const DAY_PARTS = 3
const MARKET_SEPARATOR = ':'
const MIN_YEAR = 1000
const MAX_YEAR = 9999

/** One venue the ledger can book a trade at, with the markets it holds. */
interface VenueChoice {
  readonly venue: string
  readonly markets: readonly string[]
}

/** The row being edited, or what a new one starts from. */
export interface TradeStart {
  readonly entry?: TradeEntry
  readonly ticker?: string
  readonly market?: string
}

/** One open trade dialog: every field as typed, and where its last save stands. */
export interface TradeForm {
  readonly start: TradeStart
  readonly kind: Signal<TradeKind>
  readonly ticker: Signal<string>
  readonly quantity: Signal<string>
  readonly price: Signal<string>
  readonly venue: Signal<string>
  readonly day: Signal<string>
  readonly fee: Signal<string>
  readonly venues: Signal<readonly VenueChoice[]>
  readonly question: Signal<string | undefined>
  readonly failure: Signal<FormFailure | undefined>
  /** The sentences the page itself gave a field it refused before sending, by the daemon's path. */
  readonly refused: Signal<ReadonlyMap<string, string>>
  readonly isBusy: Signal<boolean>
  // The key of the last attempt and the body it carried: the same body retries under the same key.
  attempt: { readonly key: string; readonly print: string } | undefined
}

type DraftBuild =
  | { readonly kind: 'draft'; readonly draft: TradeDraft }
  | { readonly kind: 'invalid'; readonly refused: ReadonlyMap<string, string> }

export function createTradeForm(start: TradeStart): TradeForm {
  const { entry } = start

  return {
    start,
    kind: signal(entry?.kind === 'sell' ? 'sell' : 'buy'),
    ticker: signal(entry?.instrument.ticker ?? start.ticker ?? ''),
    quantity: signal(entry === undefined ? '' : String(entry.quantity)),
    price: signal(
      entry === undefined
        ? ''
        : formatPrice(entry.unitPrice, priceDisplayOf(entry.instrument.market))
    ),
    venue: signal(entry?.venue ?? ''),
    day: signal(formatDay(locale.value, entry?.at ?? today())),
    fee: signal(entry === undefined ? '' : String(entry.fee)),
    venues: signal([]),
    question: signal(undefined),
    failure: signal(undefined),
    refused: signal(new Map()),
    isBusy: signal(false),
    attempt: undefined,
  }
}

/** The text the form holds, to tell an edited form from an untouched one. */
export function snapshotTrade(form: TradeForm): string {
  return JSON.stringify([
    form.kind.value,
    form.ticker.value,
    form.quantity.value,
    form.price.value,
    form.venue.value,
    form.day.value,
    form.fee.value,
  ])
}

/** The venues that can hold the name's market when it is known, else every venue. */
export function offerVenues(form: TradeForm): readonly VenueChoice[] {
  const market = resolveKnownMarket(form)

  if (market === undefined) {
    return form.venues.value
  }

  const holding = form.venues.value.filter((choice) => choice.markets.includes(market))

  return holding.length === 0 ? form.venues.value : holding
}

/** Picks the first venue on offer when none is chosen. */
export function chooseVenue(form: TradeForm): void {
  const offered = offerVenues(form)

  if (!offered.some((choice) => choice.venue === form.venue.value)) {
    form.venue.value = offered[0]?.venue ?? ''
  }
}

/** The draft the form describes, or the sentence for each field it cannot send. */
export function buildTradeDraft(form: TradeForm): DraftBuild {
  const typed = readTyped(form)
  const refused = collectRefusals(form, typed)
  const { market, quantity, typedPrice, fee, at, ticker } = typed

  if (
    refused.size > 0 ||
    market === undefined ||
    quantity === undefined ||
    typedPrice === undefined ||
    at === undefined
  ) {
    return { kind: 'invalid', refused }
  }

  return {
    kind: 'draft',
    draft: {
      kind: form.kind.value,
      at,
      instrument: { market, ticker },
      venue: form.venue.value,
      quantity,
      unitPrice: toWholeUnits(market, typedPrice),
      ...(fee === undefined ? {} : { fee }),
      ...(form.start.entry?.note === undefined ? {} : { note: form.start.entry.note }),
    },
  }
}

/** The market the typed name is booked in; absent while it is unknown. */
export function marketOf(form: TradeForm): string | undefined {
  return resolveMarket(form, readTicker(form))
}

/** "Sẽ ghi: mua 100 FPT giá 125,00 tại VPS, ngày 22/10/2026."; absent until the draft is complete. */
export function describeTrade(form: TradeForm): string | undefined {
  const build = buildTradeDraft(form)

  if (build.kind === 'invalid') {
    return undefined
  }

  const { draft } = build

  return tr('ui.office.trade.preview', {
    side: tr(`trading.ledger.kind.${draft.kind}`),
    quantity: formatQuantity(draft.quantity),
    ticker: draft.instrument.ticker,
    price: formatMarketPrice(draft.instrument.market, draft.unitPrice),
    venue: translateDisplayText(locale.value, {
      key: `trading.venue.${draft.venue}`,
      fallback: draft.venue,
    }),
    day: formatDay(locale.value, draft.at),
  })
}

/** The key to send the draft under: a new one whenever the body changed since the last attempt,
 *  because the daemon refuses one key carrying two different bodies. */
export function keyFor(form: TradeForm, draft: TradeDraft): string {
  const print = JSON.stringify(draft)

  if (form.attempt?.print !== print) {
    form.attempt = { key: newIdempotencyKey(), print }
  }

  return form.attempt.key
}

/** A new key for the draft that puts a deleted row back. */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_BYTES))

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

interface Typed {
  readonly ticker: string
  readonly market: string | undefined
  readonly quantity: number | undefined
  readonly typedPrice: number | undefined
  readonly fee: number | undefined
  readonly at: string | undefined
}

function readTyped(form: TradeForm): Typed {
  const ticker = readTicker(form)

  return {
    ticker,
    market: resolveMarket(form, ticker),
    quantity: toDecimal(form.quantity.value),
    typedPrice: toDecimal(form.price.value),
    fee: toDecimal(form.fee.value),
    at: parseDay(form.day.value),
  }
}

// One sentence per field the page refuses before sending, keyed by the path the daemon would use.
function collectRefusals(form: TradeForm, typed: Typed): ReadonlyMap<string, string> {
  const refused = new Map<string, string>()

  if (typed.ticker === '') {
    refused.set('instrument.ticker', tr('ui.office.common.needTicker'))
  } else if (typed.market === undefined) {
    refused.set('instrument.ticker', tr('ui.office.watch.unknown', { ticker: typed.ticker }))
  }

  if (typed.quantity === undefined || typed.quantity <= 0) {
    refused.set('quantity', tr('ui.office.trade.badQuantity'))
  } else if (isAmbiguousGrouping(form.quantity.value)) {
    refused.set('quantity', tr('ui.office.trade.groupedNumber'))
  }

  if (typed.typedPrice === undefined || typed.typedPrice <= 0) {
    refused.set('unitPrice', tr('ui.office.trade.badPrice'))
  } else if (isAmbiguousGrouping(form.price.value)) {
    refused.set('unitPrice', tr('ui.office.trade.groupedNumber'))
  }

  if (form.fee.value.trim() !== '' && typed.fee === undefined) {
    refused.set('fee', tr('ui.office.trade.badFee'))
  }

  if (typed.at === undefined) {
    refused.set('at', tr('ui.office.trade.badDay'))
  }

  return refused
}

function today(): string {
  return buildDayKey(Date.now(), state.value?.timeZone ?? FALLBACK_ZONE)
}

// "market:ticker" names the market; a bare ticker is as typed.
function readTicker(form: TradeForm): string {
  const typed = form.ticker.value.trim()
  const split = typed.indexOf(MARKET_SEPARATOR)

  return (split < 0 ? typed : typed.slice(split + 1)).toUpperCase()
}

// The market the name is known in: typed with it, given by the card, or already on this page.
function resolveKnownMarket(form: TradeForm): string | undefined {
  const typed = form.ticker.value.trim()
  const split = typed.indexOf(MARKET_SEPARATOR)

  if (split > 0) {
    return typed.slice(0, split).toLowerCase()
  }

  const ticker = readTicker(form)
  const entryMarket = form.start.entry?.instrument.market

  return (
    entryMarket ??
    form.start.market ??
    heldPositions.value.find((position) => position.instrument.ticker === ticker)?.instrument
      .market ??
    watchedNames.value.find((instrument) => instrument.ticker === ticker)?.market ??
    quotesBlock.view.value.data?.quotes.find((quote) => quote.ticker === ticker)?.market
  )
}

// A venue that holds one market settles an unknown name's market.
function resolveMarket(form: TradeForm, ticker: string): string | undefined {
  const known = resolveKnownMarket(form)

  if (known !== undefined || ticker === '') {
    return known
  }

  const markets = form.venues.value.find((choice) => choice.venue === form.venue.value)?.markets

  return markets?.length === 1 ? markets[0] : undefined
}

// "22/10/2026" (or with dots or dashes) as `YYYY-MM-DD`; absent for anything that is not a real day.
function parseDay(text: string): string | undefined {
  const parts = text.trim().split(DATE_SEPARATORS)
  const [day, month, year] = parts.map(Number)

  if (parts.length !== DAY_PARTS || !day || !month || !year || year < MIN_YEAR || year > MAX_YEAR) {
    return undefined
  }

  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const parsed = new Date(`${iso}T00:00:00Z`)

  // A day that does not exist (31/02) is not the one the date object lands on.
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso
    ? undefined
    : iso
}

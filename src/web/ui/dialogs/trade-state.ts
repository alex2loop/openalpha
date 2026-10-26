import { type Signal, signal } from '@preact/signals'

import type { LedgerEntryWire, LedgerPreviewResponse } from '@/app/server/wire/money'
import type { LedgerDraft, LedgerKind } from '@/web/state/trade'
import type { FormFailure } from '@/web/ui/dialogs/field-errors'
import { formatDay, translateDisplayText } from '@/i18n'
import {
  heldPositions,
  holdingsBlock,
  priceDisplayOf,
  quotesBlock,
  watchedNames,
} from '@/web/state/market'
import { locale, state } from '@/web/state/session'
import { isAmbiguousGrouping } from '@/web/text/decimal'
import { formatPrice, formatQuantity } from '@/web/text/figures'
import { formatMarketPrice, toWholeUnits } from '@/web/text/market-price'
import { buildDayKey } from '@/web/text/time'
import { tr } from '@/web/text/tr'
import {
  bookedRate,
  marketCurrency,
  namesInstrument,
  parseDay,
  parseFigure,
  parseSignedFigure,
  shapeOf,
  toUnsignedText,
  validateDraft,
  withStatedRate,
} from '@/web/ui/dialogs/trade-kinds'

// The daemon's zone is always known once the page is up; this only types the lookup.
const FALLBACK_ZONE = 'UTC'
const KEY_BYTES = 16
const MARKET_SEPARATOR = ':'

/** One venue the ledger can book a row at, with the markets it holds. */
interface VenueChoice {
  readonly venue: string
  readonly markets: readonly string[]
}

type FxRate = NonNullable<LedgerPreviewResponse['fxRate']>

/** The row being edited, or what a new one starts from. */
export interface TradeStart {
  readonly entry?: LedgerEntryWire
  readonly kind?: LedgerKind
  readonly ticker?: string
  readonly market?: string
  readonly venue?: string
  readonly quantity?: number
  readonly currency?: string
  readonly amount?: number
}

/** One open ledger dialog: every field as typed, and where its last save stands. The quantity
 *  field also holds a split's or a stock dividend's share change. */
export interface TradeForm {
  readonly start: TradeStart
  readonly kind: Signal<LedgerKind>
  readonly ticker: Signal<string>
  readonly quantity: Signal<string>
  readonly price: Signal<string>
  readonly venue: Signal<string>
  readonly fromVenue: Signal<string>
  readonly day: Signal<string>
  readonly fee: Signal<string>
  readonly amount: Signal<string>
  readonly currency: Signal<string>
  readonly rate: Signal<string>
  readonly note: Signal<string>
  /** The day's market rate the daemon asked for; absent where no rate applies. */
  readonly fxRate: Signal<FxRate | undefined>
  /** Whether that ask is settled, under way, or failed: only a settled one lets the row save. */
  readonly fxStatus: Signal<'idle' | 'pending' | 'failed'>
  /** Bumped by Thử lại to ask again. */
  readonly fxRetry: Signal<number>
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
  | { readonly kind: 'draft'; readonly draft: LedgerDraft }
  | { readonly kind: 'invalid'; readonly refused: ReadonlyMap<string, string> }

type Figures = Pick<TradeForm, 'quantity' | 'price' | 'fee' | 'amount' | 'currency' | 'rate'>

export function createTradeForm(start: TradeStart): TradeForm {
  const { entry } = start

  return {
    start,
    kind: signal(entry?.kind ?? start.kind ?? 'buy'),
    ticker: signal(
      entry !== undefined && 'instrument' in entry ? entry.instrument.ticker : (start.ticker ?? '')
    ),
    venue: signal(entry?.venue ?? start.venue ?? ''),
    fromVenue: signal(entry?.kind === 'transfer' ? entry.fromVenue : ''),
    day: signal(formatDay(locale.value, entry?.at ?? today())),
    note: signal(entry?.note ?? ''),
    ...startFigures(start),
    fxRate: signal(undefined),
    fxStatus: signal('idle'),
    fxRetry: signal(0),
    venues: signal([]),
    question: signal(undefined),
    failure: signal(undefined),
    refused: signal(new Map()),
    isBusy: signal(false),
    attempt: undefined,
  }
}

// An edit starts from the row; a row stated in another currency keeps the rate it was booked at.
function startFigures({ entry, quantity, amount, currency }: TradeStart): Figures {
  const held = entry === undefined ? undefined : heldFigure(entry)

  return {
    quantity: signal(textOf(held ?? quantity)),
    price: signal(
      entry !== undefined && 'unitPrice' in entry
        ? formatPrice(entry.unitPrice, priceDisplayOf(entry.instrument.market))
        : ''
    ),
    fee: signal(entry !== undefined && 'fee' in entry ? String(entry.fee) : ''),
    amount: signal(
      entry !== undefined && 'amount' in entry ? String(entry.amount) : textOf(amount)
    ),
    currency: signal(
      entry !== undefined && 'currency' in entry ? entry.currency : (currency ?? '')
    ),
    rate: signal(textOf(entry === undefined ? undefined : bookedRate(entry))),
  }
}

function heldFigure(entry: LedgerEntryWire): number | undefined {
  if ('quantity' in entry) {
    return entry.quantity
  }

  return 'quantityDelta' in entry ? entry.quantityDelta : undefined
}

function textOf(value: number | undefined): string {
  return value === undefined ? '' : String(value)
}

/** The text the form holds, to tell an edited form from an untouched one. */
export function snapshotTrade(form: TradeForm): string {
  return JSON.stringify([
    form.kind.value,
    form.ticker.value,
    form.quantity.value,
    form.price.value,
    form.venue.value,
    form.fromVenue.value,
    form.day.value,
    form.fee.value,
    form.amount.value,
    form.currency.value,
    form.rate.value,
    form.note.value,
  ])
}

/** The venues that can hold the name's market when the row names a known one, else every venue. */
export function offerVenues(form: TradeForm): readonly VenueChoice[] {
  const market = namesInstrument(form.kind.value) ? resolveKnownMarket(form) : undefined

  if (market === undefined) {
    return form.venues.value
  }

  const holding = form.venues.value.filter((choice) => choice.markets.includes(market))

  return holding.length === 0 ? form.venues.value : holding
}

/** Picks the first venue and currency on offer where none is chosen. */
export function chooseVenue(form: TradeForm): void {
  const offered = offerVenues(form).map((choice) => choice.venue)

  if (!offered.includes(form.venue.value)) {
    form.venue.value = offered[0] ?? ''
  }

  if (!offered.includes(form.fromVenue.value)) {
    form.fromVenue.value = offered[0] ?? ''
  }

  const currencies = offerCurrencies(form)

  if (!currencies.includes(form.currency.value)) {
    form.currency.value = currencies[0] ?? ''
  }
}

/** The book's currency, then the ones the paying venue's markets quote in, then the row's own. */
export function offerCurrencies(form: TradeForm): readonly string[] {
  const base = holdingsBlock.view.value.data?.baseCurrency
  const payer = form.kind.value === 'transfer' ? form.fromVenue.value : form.venue.value
  const markets = form.venues.value.find((choice) => choice.venue === payer)?.markets ?? []
  const quoted = markets.flatMap((market) => marketCurrency(market) ?? [])
  const { entry, currency } = form.start
  const own = entry !== undefined && 'currency' in entry ? entry.currency : currency

  return [...new Set([base, ...quoted, own].filter((code) => code !== undefined))]
}

/** The draft the form describes, or the sentence for each field it cannot send. */
export function buildTradeDraft(form: TradeForm): DraftBuild {
  const composed = composeDraft(form)
  const draft = composed === undefined ? undefined : withStatedRate(composed, statedRate(form))
  const refused = collectRefusals(form)

  for (const issue of draft === undefined ? [] : validateDraft(draft)) {
    if (!refused.has(issue.path)) {
      refused.set(issue.path, issue.message)
    }
  }

  return draft === undefined || refused.size > 0
    ? { kind: 'invalid', refused }
    : { kind: 'draft', draft }
}

/** The complete draft with no rate, which the daemon is asked about; absent while incomplete. */
export function buildPreviewDraft(form: TradeForm): LedgerDraft | undefined {
  const draft = composeDraft(form)

  return draft === undefined || validateDraft(draft).length > 0 ? undefined : draft
}

/** The market the typed name is booked in; absent while it is unknown. */
export function marketOf(form: TradeForm): string | undefined {
  return resolveMarket(form, readTicker(form))
}

/** "Sẽ ghi: mua 100 FPT giá 125,00 tại VPS, ngày 22/10/2026."; absent until a trade is complete. */
export function describeTrade(form: TradeForm): string | undefined {
  const build = buildTradeDraft(form)

  if (build.kind === 'invalid' || !('unitPrice' in build.draft)) {
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
export function keyFor(form: TradeForm, draft: LedgerDraft): string {
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

// A figure the page cannot read is NaN, which `validateDraft` refuses as out of range.
function composeDraft(form: TradeForm): LedgerDraft | undefined {
  const at = parseDay(form.day.value)
  const note = form.note.value.trim()

  if (at === undefined) {
    return undefined
  }

  const base = { at, ...(note === '' ? {} : { note }) }
  const kind = form.kind.value
  const amount = parseFigure(form.amount.value)
  const venue = form.venue.value
  const currency = form.currency.value

  switch (kind) {
    case 'transfer':
      return {
        ...base,
        kind,
        fromVenue: form.fromVenue.value,
        venue,
        currency,
        amount,
        fee: toFee(form) ?? 0,
      }
    case 'deposit':
    case 'withdrawal':
    case 'fee':
    case 'loss':
      return { ...base, kind, venue, currency, amount }
    default:
      return composeHolding(form, base)
  }
}

function composeHolding(
  form: TradeForm,
  base: { readonly at: string; readonly note?: string }
): LedgerDraft | undefined {
  const market = marketOf(form)
  const kind = form.kind.value

  if (market === undefined) {
    return undefined
  }

  const held = {
    ...base,
    instrument: { market, ticker: readTicker(form) },
    venue: form.venue.value,
  }
  // The daemon prices no rights allotment from a fee table: an empty fee is none.
  const fee = kind === 'rights' ? (toFee(form) ?? 0) : toFee(form)

  switch (kind) {
    case 'buy':
    case 'sell':
    case 'rights':
      return {
        ...held,
        kind,
        quantity: parseFigure(form.quantity.value),
        unitPrice: toWholeUnits(market, parseFigure(form.price.value)),
        ...(fee === undefined ? {} : { fee }),
      }
    case 'dividend':
      return { ...held, kind, amount: parseFigure(form.amount.value) }
    case 'split':
    case 'distribution':
      return { ...held, kind, quantityDelta: parseSignedFigure(form.quantity.value) }
    default:
      return undefined
  }
}

// Asked for only where the daemon's preview answered a rate; an empty field is refused there.
function statedRate(form: TradeForm): number | undefined {
  return form.fxRate.value === undefined ? undefined : parseFigure(form.rate.value)
}

function toFee(form: TradeForm): number | undefined {
  return form.fee.value.trim() === '' ? undefined : parseFigure(form.fee.value)
}

// What the page refuses from the text itself, keyed by the path the daemon would use; the figures'
// ranges are `validateDraft`'s.
function collectRefusals(form: TradeForm): Map<string, string> {
  const refused = new Map<string, string>()
  const ticker = readTicker(form)

  if (namesInstrument(form.kind.value) && ticker === '') {
    refused.set('instrument.ticker', tr('ui.office.common.needTicker'))
  } else if (namesInstrument(form.kind.value) && marketOf(form) === undefined) {
    refused.set('instrument.ticker', tr('ui.office.watch.unknown', { ticker }))
  }

  for (const [path, text] of groupedTexts(form)) {
    if (isAmbiguousGrouping(text)) {
      refused.set(path, tr('ui.office.trade.groupedNumber'))
    }
  }

  if (parseDay(form.day.value) === undefined) {
    refused.set('at', tr('ui.office.trade.badDay'))
  }

  return refused
}

// The figures a thousands separator could misread, by the path each is sent under.
function groupedTexts(form: TradeForm): readonly (readonly [string, string])[] {
  const rate: readonly (readonly [string, string])[] =
    form.fxRate.value === undefined ? [] : [['operatorFxRate', form.rate.value]]

  switch (shapeOf(form.kind.value)) {
    case 'priced':
      return [['quantity', form.quantity.value], ['unitPrice', form.price.value], ...rate]
    case 'shares':
      return [['quantityDelta', toUnsignedText(form.quantity.value)]]
    case 'dividend':
      return [['amount', form.amount.value]]
    default:
      return [['amount', form.amount.value], ...rate]
  }
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
  const { entry } = form.start
  const entryMarket =
    entry !== undefined && 'instrument' in entry ? entry.instrument.market : undefined

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

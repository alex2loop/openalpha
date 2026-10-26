import type { ApiFieldError } from '@/app/server/wire/errors'
import type { LedgerEntryWire } from '@/app/server/wire/money'
import type { MessageKey } from '@/i18n'
import type { LedgerDraft, LedgerKind } from '@/web/state/trade'
import { knownMarkets } from '@/web/state/market'
import { toDecimal } from '@/web/text/decimal'
import { tr } from '@/web/text/tr'

const DATE_SEPARATORS = /[/.\-\s]+/
const DAY_PARTS = 3
const MIN_YEAR = 1000
const MAX_YEAR = 9999
const MINUS_SIGN = '-'

/** How the dialog lays a kind out: a trade with a price, a cash dividend, a share-count change, a
 *  move between venues, or cash in or out of one venue. */
type KindShape = 'priced' | 'dividend' | 'shares' | 'transfer' | 'cash'

/** The kinds under Khác, in menu order, each with the hint beside its name. */
export const OTHER_KINDS: readonly { readonly kind: LedgerKind; readonly hint: MessageKey }[] =
  Object.freeze([
    { kind: 'dividend', hint: 'ui.office.trade.hint.dividend' },
    { kind: 'distribution', hint: 'ui.office.trade.hint.distribution' },
    { kind: 'split', hint: 'ui.office.trade.hint.split' },
    { kind: 'rights', hint: 'ui.office.trade.hint.rights' },
    { kind: 'transfer', hint: 'ui.office.trade.hint.transfer' },
    { kind: 'deposit', hint: 'ui.office.trade.hint.deposit' },
    { kind: 'withdrawal', hint: 'ui.office.trade.hint.withdrawal' },
    { kind: 'fee', hint: 'ui.office.trade.hint.fee' },
    { kind: 'loss', hint: 'ui.office.trade.hint.loss' },
  ])

const INSTRUMENT_PATHS = ['instrument.ticker', 'instrument.market', 'venue', 'at'] as const

/** The draft paths each layout has a field for, so a refusal for any other goes to the top line. */
const SHAPE_PATHS: Readonly<Record<KindShape, readonly string[]>> = Object.freeze({
  priced: [...INSTRUMENT_PATHS, 'quantity', 'unitPrice', 'fee'],
  dividend: [...INSTRUMENT_PATHS, 'amount'],
  shares: [...INSTRUMENT_PATHS, 'quantityDelta'],
  transfer: ['fromVenue', 'venue', 'currency', 'amount', 'fee', 'at'],
  cash: ['venue', 'currency', 'amount', 'at', 'note'],
})

export function shapeOf(kind: LedgerKind): KindShape {
  switch (kind) {
    case 'buy':
    case 'sell':
    case 'rights':
      return 'priced'
    case 'dividend':
      return 'dividend'
    case 'split':
    case 'distribution':
      return 'shares'
    case 'transfer':
      return 'transfer'
    default:
      return 'cash'
  }
}

/** The paths the kind's layout shows a field for. */
export function fieldPathsOf(kind: LedgerKind): readonly string[] {
  return SHAPE_PATHS[shapeOf(kind)]
}

/** Whether the row names a holding. */
export function namesInstrument(kind: LedgerKind): boolean {
  const shape = shapeOf(kind)

  return shape === 'priced' || shape === 'dividend' || shape === 'shares'
}

/** The currency the row moves, where a rate could apply: a dividend and a share-count change never
 *  take one. Absent while a trade's market is unknown. */
export function currencyOf(draft: LedgerDraft): string | undefined {
  if ('currency' in draft) {
    return draft.currency
  }

  return draft.kind === 'buy' || draft.kind === 'sell' || draft.kind === 'rights'
    ? marketCurrency(draft.instrument.market)
    : undefined
}

export function marketCurrency(market: string): string | undefined {
  return knownMarkets.value.find((known) => known.market === market)?.currency
}

/** The draft with the rate the operator stated, on the kinds that take one. */
export function withStatedRate(draft: LedgerDraft, rate: number | undefined): LedgerDraft {
  if (rate === undefined) {
    return draft
  }

  switch (draft.kind) {
    case 'dividend':
    case 'split':
    case 'distribution':
      return draft
    default:
      return { ...draft, operatorFxRate: rate, fxRateConfirmed: true }
  }
}

/** The sentence for each figure the page refuses before sending, by the daemon's path.
 *  A figure the page could not read arrives as NaN and is refused as out of range. */
export function validateDraft(draft: LedgerDraft): readonly ApiFieldError[] {
  return [...figureIssues(draft), ...rateIssues(draft)]
}

function figureIssues(draft: LedgerDraft): readonly ApiFieldError[] {
  switch (draft.kind) {
    case 'buy':
    case 'sell':
    case 'rights':
      return [
        ...issue('quantity', !(draft.quantity > 0), 'ui.office.trade.badQuantity'),
        ...issue('unitPrice', !(draft.unitPrice > 0), 'ui.office.trade.badPrice'),
        ...issue('fee', draft.fee !== undefined && !(draft.fee >= 0), 'ui.office.trade.badFee'),
      ]
    case 'split':
      return issue('quantityDelta', !isWholeChange(draft.quantityDelta), 'ui.office.trade.badDelta')
    case 'distribution':
      return issue(
        'quantityDelta',
        !(isWholeChange(draft.quantityDelta) && draft.quantityDelta > 0),
        'ui.office.trade.badDelta'
      )
    case 'transfer':
      return [
        ...issue('venue', draft.fromVenue === draft.venue, 'ui.office.trade.sameVenue'),
        ...issue('amount', !(draft.amount > 0), 'ui.office.trade.badAmount'),
        ...issue('fee', !(draft.fee >= 0), 'ui.office.trade.badFee'),
      ]
    default:
      return issue('amount', !(draft.amount > 0), 'ui.office.trade.badAmount')
  }
}

function rateIssues(draft: LedgerDraft): readonly ApiFieldError[] {
  const rate = 'operatorFxRate' in draft ? draft.operatorFxRate : undefined

  return issue('operatorFxRate', rate !== undefined && !(rate > 0), 'ui.office.trade.badRate')
}

function issue(path: string, isRefused: boolean, key: MessageKey): readonly ApiFieldError[] {
  return isRefused ? [{ path, message: tr(key) }] : []
}

function isWholeChange(value: number): boolean {
  return Number.isInteger(value) && value !== 0
}

/** The draft that records `entry` again, for taking back a delete or editing it. */
export function toLedgerDraft(entry: LedgerEntryWire): LedgerDraft {
  const base = { at: entry.at, ...(entry.note === undefined ? {} : { note: entry.note }) }

  switch (entry.kind) {
    case 'buy':
    case 'sell':
    case 'rights': {
      const { kind, instrument, venue, quantity, unitPrice, fee } = entry

      return { ...base, kind, instrument: toRef(instrument), venue, quantity, unitPrice, fee }
    }
    case 'dividend':
      return {
        ...base,
        kind: 'dividend',
        instrument: toRef(entry.instrument),
        venue: entry.venue,
        amount: entry.amount,
      }
    case 'split':
    case 'distribution': {
      const { kind, instrument, venue, quantityDelta } = entry

      return { ...base, kind, instrument: toRef(instrument), venue, quantityDelta }
    }
    case 'transfer': {
      const { fromVenue, venue, currency, amount, fee } = entry

      return { ...base, kind: 'transfer', fromVenue, venue, currency, amount, fee }
    }
    default: {
      const { kind, venue, currency, amount } = entry

      return { ...base, kind, venue, currency, amount }
    }
  }
}

interface InstrumentRef {
  readonly market: string
  readonly ticker: string
}

function toRef(instrument: InstrumentRef): InstrumentRef {
  return { market: instrument.market, ticker: instrument.ticker }
}

/** The row's subject as a title names it: the ticker, or the currency of a cash row. */
export function subjectOf(entry: LedgerEntryWire): string {
  return 'instrument' in entry ? entry.instrument.ticker : entry.currency
}

/** The rate a row in another currency was booked at, for an edit or a restore to state again. */
export function bookedRate(entry: LedgerEntryWire): number | undefined {
  if (!('conversion' in entry)) {
    return undefined
  }

  const { conversion } = entry

  return conversion.fromCurrency === conversion.toCurrency ? undefined : conversion.rate
}

/** A typed figure; one the page cannot read is NaN, which `validateDraft` refuses. */
export function parseFigure(text: string): number {
  return toDecimal(text) ?? Number.NaN
}

/** A share change: a reverse split removes shares, so a leading minus is kept. */
export function parseSignedFigure(text: string): number {
  const typed = text.trim()

  return typed.startsWith(MINUS_SIGN) ? -parseFigure(toUnsignedText(typed)) : parseFigure(typed)
}

/** The text without its leading minus, for the checks a figure's digits get. */
export function toUnsignedText(text: string): string {
  const typed = text.trim()

  return typed.startsWith(MINUS_SIGN) ? typed.slice(MINUS_SIGN.length) : typed
}

/** "22/10/2026" (or with dots or dashes) as `YYYY-MM-DD`; absent for anything that is not a real day. */
export function parseDay(text: string): string | undefined {
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

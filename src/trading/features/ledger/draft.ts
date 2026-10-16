import type { CommandMessage, CommandMessageKey } from '@/core/types/command'
import type {
  LedgerTxnDraft,
  LedgerTxnDraftInput,
  TradeTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { CurrencyCode, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import {
  CASH_TXN_KINDS,
  FX_AUTO,
  FX_TOKEN,
  isSellAllDraft,
  QUANTITY_TXN_KINDS,
  SELL_ALL,
  TRADE_TXN_KINDS,
  TRANSFER_TXN_KIND,
} from '@/trading/features/ledger/types'
import { currencyCode, tradingDay, venueRef } from '@/trading/kernel/instrument'
import {
  parseBranded,
  parseFiniteNumber,
  parseMember,
  parseQualifiedInstrument,
} from '@/trading/kernel/surface/surface'

export const SYNC_ACTION = 'sync'

const CASH_TOKENS = 4
const TRANSFER_TOKENS = 6
const DIVIDEND_TOKENS = 5
const QUANTITY_ADJUSTMENT_TOKENS = 4
const TRADE_TOKENS_WITH_FEE = 7
const TRADE_TOKENS_WITHOUT_FEE = 6

/** Every token a ledger line names, with the sentence saying what it expects there. */
export const LEDGER_FIELD_KEYS = Object.freeze({
  venue: 'slash.ledgerFieldVenue',
  instrument: 'slash.ledgerFieldInstrument',
  quantity: 'slash.ledgerFieldQuantity',
  price: 'slash.ledgerFieldPrice',
  amount: 'slash.ledgerFieldAmount',
  currency: 'slash.ledgerFieldCurrency',
  fee: 'slash.ledgerFieldFee',
  day: 'slash.ledgerFieldDay',
  fx: 'slash.ledgerFieldFx',
  delta: 'slash.ledgerFieldDelta',
} as const satisfies Record<string, CommandMessageKey>)

type LedgerField = keyof typeof LEDGER_FIELD_KEYS

export interface LedgerFieldIssue {
  readonly field: LedgerField
  readonly token: string
}

/** `invalid` names the first token that did not parse once the line had the right shape; a wrong
 *  kind or token count names none, since no single token is then the one at fault. */
type LedgerDraftParse =
  | { readonly kind: 'draft'; readonly draft: LedgerTxnDraftInput }
  | { readonly kind: 'invalid'; readonly issue?: LedgerFieldIssue }

/** Reads one line's tokens in order and keeps the first that did not parse. One per parse. */
interface FieldReader {
  read<T>(field: LedgerField, raw: string | undefined, parse: (raw: string) => T | null): T | null
  issue(): LedgerFieldIssue | undefined
}

/** One ledger grammar for every operator surface that takes raw tokens: `/record` and `/update`
 *  share it, so a new transaction kind cannot be accepted by one and rejected by the other.
 *
 *  Never guesses: an unreadable line is `invalid` and the caller answers with its usage. A trade
 *  may omit its fee, which resolution prices off the market's configured rate — never a zero, which
 *  would understate the book forever. No other arm supplies a business default. */
export function parseLedgerDraft(tokens: readonly string[]): LedgerDraftParse {
  const reader = createFieldReader()
  const split = splitFxTokens(tokens, reader)
  const draft = split === null ? null : parseLedgerFields(split.fields, reader)
  const priced = draft === null || split?.fx === undefined ? draft : withFx(draft, split.fx)

  if (priced === null) {
    const issue = reader.issue()

    return issue === undefined ? { kind: 'invalid' } : { kind: 'invalid', issue }
  }

  return { kind: 'draft', draft: priced }
}

function createFieldReader(): FieldReader {
  let first: LedgerFieldIssue | undefined

  return {
    read(field, raw, parse) {
      const value = raw === undefined ? null : parse(raw)

      if (value === null && first === undefined) {
        first = { field, token: raw ?? '' }
      }

      return value
    },
    issue: () => first,
  }
}

/** A share-count adjustment moves no money, so a rate on one is a typo, not a choice. */
function withFx(
  draft: LedgerTxnDraftInput,
  fx: number | typeof FX_AUTO
): LedgerTxnDraftInput | null {
  if (!('currency' in draft)) {
    return null
  }

  return fx === FX_AUTO ? { ...draft, fxRateConfirmed: true } : { ...draft, operatorFxRate: fx }
}

interface FxTokens {
  readonly fields: readonly string[]
  readonly fx?: number | typeof FX_AUTO
}

function splitFxTokens(tokens: readonly string[], reader: FieldReader): FxTokens | null {
  if (tokens.at(-2) !== FX_TOKEN) {
    return { fields: tokens }
  }

  const fields = tokens.slice(0, -2)
  const raw = tokens.at(-1)

  if (raw === FX_AUTO) {
    return { fields, fx: FX_AUTO }
  }

  const rate = reader.read('fx', raw, positiveNumber)

  return rate === null ? null : { fields, fx: rate }
}

function parseLedgerFields(
  tokens: readonly string[],
  reader: FieldReader
): LedgerTxnDraftInput | null {
  const [kind, ...rest] = tokens
  const cashKind = parseMember(kind, CASH_TXN_KINDS)

  if (cashKind !== null) {
    return parseCash(cashKind, rest, reader)
  }

  const tradeKind = parseMember(kind, TRADE_TXN_KINDS)

  if (tradeKind !== null) {
    return parseTrade(tradeKind, rest, reader)
  }

  if (kind === 'dividend') {
    return parseDividend(rest, reader)
  }

  const quantityKind = parseMember(kind, QUANTITY_TXN_KINDS)

  if (quantityKind !== null) {
    return parseQuantityAdjustment(quantityKind, rest, reader)
  }

  if (kind === TRANSFER_TXN_KIND) {
    return parseTransfer(rest, reader)
  }

  return null
}

/** The line naming the token to fix, ahead of the usage it belongs to. */
export function fieldIssueMessages(issue: LedgerFieldIssue | undefined): readonly CommandMessage[] {
  return issue === undefined
    ? []
    : [{ key: LEDGER_FIELD_KEYS[issue.field], values: { token: issue.token } }]
}

/** `/record sync <venue>` names exactly one custodian: syncing every venue at once would put a
 *  network call behind a command the operator may have typed to read its usage. */
export function parseSyncRequest(tokens: readonly string[]): VenueRef | null {
  const [action, venue, ...rest] = tokens

  if (action !== SYNC_ACTION || rest.length > 0) {
    return null
  }

  return parseBranded(venue, venueRef)
}

function parseCash(
  kind: (typeof CASH_TXN_KINDS)[number],
  rest: readonly string[],
  reader: FieldReader
): LedgerTxnDraftInput | null {
  if (rest.length !== CASH_TOKENS) {
    return null
  }

  const venue = reader.read('venue', rest[0], toVenue)
  const amount = reader.read('amount', rest[1], positiveNumber)
  const currency = reader.read('currency', rest[2], toCurrency)
  const at = reader.read('day', rest[3], toDay)

  if (venue === null || amount === null || currency === null || at === null) {
    return null
  }

  return { kind, venue, amount, currency, at }
}

function parseTrade(
  kind: (typeof TRADE_TXN_KINDS)[number],
  rest: readonly string[],
  reader: FieldReader
): LedgerTxnDraftInput | null {
  const stated = rest.length === TRADE_TOKENS_WITH_FEE

  // `rights` keeps its fee: it is not a brokered purchase at the standard rate, so there is no
  // rate to fill it from.
  if (!stated && (rest.length !== TRADE_TOKENS_WITHOUT_FEE || kind === 'rights')) {
    return null
  }

  const venue = reader.read('venue', rest[0], toVenue)
  const instrument = reader.read('instrument', rest[1], parseQualifiedInstrument)
  const quantity = reader.read('quantity', rest[2], (raw) => parseTradeQuantity(kind, raw))
  const unitPrice = reader.read('price', rest[3], positiveNumber)
  const currency = reader.read('currency', rest[4], toCurrency)
  const fee = stated ? reader.read('fee', rest[5], nonNegativeNumber) : undefined
  const at = reader.read('day', rest[stated ? 6 : 5], toDay)

  if (venue === null || instrument === null || currency === null || at === null) {
    return null
  }

  if (quantity === null || unitPrice === null || fee === null) {
    return null
  }

  const trade = {
    venue,
    instrument,
    unitPrice,
    currency,
    at,
    ...(fee === undefined ? {} : { fee }),
  }

  return quantity === SELL_ALL ? { kind: 'sell', quantity, ...trade } : { kind, quantity, ...trade }
}

/** `all` closes the position, so only a sale may name it: a buy of the whole position is not a
 *  quantity the book can answer. */
function parseTradeQuantity(
  kind: (typeof TRADE_TXN_KINDS)[number],
  raw: string
): number | typeof SELL_ALL | null {
  if (raw === SELL_ALL) {
    return kind === 'sell' ? SELL_ALL : null
  }

  return positiveNumber(raw)
}

function parseDividend(rest: readonly string[], reader: FieldReader): LedgerTxnDraftInput | null {
  if (rest.length !== DIVIDEND_TOKENS) {
    return null
  }

  const venue = reader.read('venue', rest[0], toVenue)
  const instrument = reader.read('instrument', rest[1], parseQualifiedInstrument)
  const amount = reader.read('amount', rest[2], positiveNumber)
  const currency = reader.read('currency', rest[3], toCurrency)
  const at = reader.read('day', rest[4], toDay)

  if (venue === null || instrument === null || amount === null) {
    return null
  }

  if (currency === null || at === null) {
    return null
  }

  return { kind: 'dividend', venue, instrument, amount, currency, at }
}

/** A share-count adjustment moves no money, so this form accepts no currency or FX token at all. */
function parseQuantityAdjustment(
  kind: (typeof QUANTITY_TXN_KINDS)[number],
  rest: readonly string[],
  reader: FieldReader
): LedgerTxnDraftInput | null {
  if (rest.length !== QUANTITY_ADJUSTMENT_TOKENS) {
    return null
  }

  const venue = reader.read('venue', rest[0], toVenue)
  const instrument = reader.read('instrument', rest[1], parseQualifiedInstrument)
  const quantityDelta = reader.read('delta', rest[2], nonZeroNumber)
  const at = reader.read('day', rest[3], toDay)

  if (venue === null || instrument === null || quantityDelta === null || at === null) {
    return null
  }

  return { kind, venue, instrument, quantityDelta, at }
}

function parseTransfer(rest: readonly string[], reader: FieldReader): LedgerTxnDraftInput | null {
  if (rest.length !== TRANSFER_TOKENS) {
    return null
  }

  const fromVenue = reader.read('venue', rest[0], toVenue)
  const venue = reader.read('venue', rest[1], toVenue)
  const amount = reader.read('amount', rest[2], positiveNumber)
  const currency = reader.read('currency', rest[3], toCurrency)
  const fee = reader.read('fee', rest[4], nonNegativeNumber)
  const at = reader.read('day', rest[5], toDay)

  if (fromVenue === null || venue === null || amount === null) {
    return null
  }

  if (currency === null || fee === null || at === null) {
    return null
  }

  return { kind: TRANSFER_TXN_KIND, fromVenue, venue, amount, currency, fee, at }
}

function toVenue(raw: string): VenueRef | null {
  return parseBranded(raw, venueRef)
}

function toCurrency(raw: string): CurrencyCode | null {
  return parseBranded(raw, currencyCode)
}

function toDay(raw: string): TradingDay | null {
  return parseBranded(raw, tradingDay)
}

function positiveNumber(raw: string): number | null {
  const value = parseFiniteNumber(raw)

  return value === null || value <= 0 ? null : value
}

function nonNegativeNumber(raw: string): number | null {
  const value = parseFiniteNumber(raw)

  return value === null || value < 0 ? null : value
}

/** A zero delta adjusts nothing: the row folds to a no-op and still takes a fingerprint, a page of
 *  history and a line in every export. */
function nonZeroNumber(raw: string): number | null {
  const value = parseFiniteNumber(raw)

  return value === null || value === 0 ? null : value
}

/** Whether the input states everything a stored row needs. An edit must: it names a row that
 *  already carries a quantity and a fee, and re-resolving either against a later book or a changed
 *  rate would move a settled figure the operator never restated. */
export function isResolvedDraft(input: LedgerTxnDraftInput): input is LedgerTxnDraft {
  if (isSellAllDraft(input)) {
    return false
  }

  if (!isTradeDraft(input)) {
    return true
  }

  return input.fee !== undefined
}

/** Whether a venue could have filled this. A close is excluded because it carries an instruction
 *  where its quantity belongs, and nothing can be matched against a fill until that is a count. */
export function isTradeDraft(input: LedgerTxnDraftInput): input is TradeTxnDraftInput {
  return !isSellAllDraft(input) && parseMember(input.kind, TRADE_TXN_KINDS) !== null
}

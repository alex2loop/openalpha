import type {
  LedgerTxnDraft,
  LedgerTxnDraftInput,
  TradeTxnDraftInput,
} from '@/trading/features/ledger/types'
import type { VenueRef } from '@/trading/kernel/instrument'
import {
  CASH_TXN_KINDS,
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

const SYNC_ACTION = 'sync'

const CASH_TOKENS = 4
const TRANSFER_TOKENS = 6
const DIVIDEND_TOKENS = 5
const QUANTITY_ADJUSTMENT_TOKENS = 4
const TRADE_TOKENS_WITH_FEE = 7
const TRADE_TOKENS_WITHOUT_FEE = 6

/** One ledger grammar for every operator surface that takes raw tokens: `/record` and `/update`
 *  share it, so a new transaction kind cannot be accepted by one and rejected by the other.
 *
 *  Returns `null` rather than guessing: the caller answers with its own usage text. A trade may
 *  omit its fee, which resolution prices off the market's configured rate — never a zero, which
 *  would understate the book forever. No other arm supplies a business default. */
export function parseLedgerDraft(tokens: readonly string[]): LedgerTxnDraftInput | null {
  const [kind, ...rest] = tokens
  const cashKind = parseMember(kind, CASH_TXN_KINDS)

  if (cashKind !== null) {
    return parseCash(cashKind, rest)
  }

  const tradeKind = parseMember(kind, TRADE_TXN_KINDS)

  if (tradeKind !== null) {
    return parseTrade(tradeKind, rest)
  }

  if (kind === 'dividend') {
    return parseDividend(rest)
  }

  const quantityKind = parseMember(kind, QUANTITY_TXN_KINDS)

  if (quantityKind !== null) {
    return parseQuantityAdjustment(quantityKind, rest)
  }

  if (kind === TRANSFER_TXN_KIND) {
    return parseTransfer(rest)
  }

  return null
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
  rest: readonly string[]
): LedgerTxnDraftInput | null {
  if (rest.length !== CASH_TOKENS) {
    return null
  }

  const venue = parseBranded(rest[0], venueRef)
  const amount = parseFiniteNumber(rest[1])
  const currency = parseBranded(rest[2], currencyCode)
  const at = parseBranded(rest[3], tradingDay)

  if (venue === null || amount === null || amount <= 0 || currency === null || at === null) {
    return null
  }

  return { kind, venue, amount, currency, at }
}

function parseTrade(
  kind: (typeof TRADE_TXN_KINDS)[number],
  rest: readonly string[]
): LedgerTxnDraftInput | null {
  const stated = rest.length === TRADE_TOKENS_WITH_FEE

  // `rights` keeps its fee: it is not a brokered purchase at the standard rate, so there is no
  // rate to fill it from.
  if (!stated && (rest.length !== TRADE_TOKENS_WITHOUT_FEE || kind === 'rights')) {
    return null
  }

  const venue = parseBranded(rest[0], venueRef)
  const instrument = parseQualifiedInstrument(rest[1])
  const quantity = parseTradeQuantity(kind, rest[2])
  const unitPrice = parseFiniteNumber(rest[3])
  const currency = parseBranded(rest[4], currencyCode)
  const fee = stated ? parseFiniteNumber(rest[5]) : undefined
  const at = parseBranded(rest[stated ? 6 : 5], tradingDay)

  if (venue === null || instrument === null || currency === null || at === null) {
    return null
  }

  if (quantity === null || unitPrice === null || unitPrice <= 0) {
    return null
  }

  if (fee === null || (fee !== undefined && fee < 0)) {
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
  raw: string | undefined
): number | typeof SELL_ALL | null {
  if (raw === SELL_ALL) {
    return kind === 'sell' ? SELL_ALL : null
  }

  const quantity = parseFiniteNumber(raw)

  return quantity === null || quantity <= 0 ? null : quantity
}

function parseDividend(rest: readonly string[]): LedgerTxnDraftInput | null {
  if (rest.length !== DIVIDEND_TOKENS) {
    return null
  }

  const venue = parseBranded(rest[0], venueRef)
  const instrument = parseQualifiedInstrument(rest[1])
  const amount = parseFiniteNumber(rest[2])
  const currency = parseBranded(rest[3], currencyCode)
  const at = parseBranded(rest[4], tradingDay)

  if (venue === null || instrument === null || currency === null || at === null) {
    return null
  }

  if (amount === null || amount <= 0) {
    return null
  }

  return { kind: 'dividend', venue, instrument, amount, currency, at }
}

/** A share-count adjustment moves no money, so this form accepts no currency or FX token at all. */
function parseQuantityAdjustment(
  kind: (typeof QUANTITY_TXN_KINDS)[number],
  rest: readonly string[]
): LedgerTxnDraftInput | null {
  if (rest.length !== QUANTITY_ADJUSTMENT_TOKENS) {
    return null
  }

  const venue = parseBranded(rest[0], venueRef)
  const instrument = parseQualifiedInstrument(rest[1])
  const quantityDelta = parseFiniteNumber(rest[2])
  const at = parseBranded(rest[3], tradingDay)

  if (venue === null || instrument === null || at === null) {
    return null
  }

  // A zero delta adjusts nothing: the row folds to a no-op and still takes a fingerprint, a page of
  // history and a line in every export.
  if (quantityDelta === null || quantityDelta === 0) {
    return null
  }

  return { kind, venue, instrument, quantityDelta, at }
}

function parseTransfer(rest: readonly string[]): LedgerTxnDraftInput | null {
  if (rest.length !== TRANSFER_TOKENS) {
    return null
  }

  const fromVenue = parseBranded(rest[0], venueRef)
  const venue = parseBranded(rest[1], venueRef)
  const amount = parseFiniteNumber(rest[2])
  const currency = parseBranded(rest[3], currencyCode)
  const fee = parseFiniteNumber(rest[4])
  const at = parseBranded(rest[5], tradingDay)

  if (fromVenue === null || venue === null || currency === null || at === null) {
    return null
  }

  if (amount === null || amount <= 0 || fee === null || fee < 0) {
    return null
  }

  return { kind: TRANSFER_TXN_KIND, fromVenue, venue, amount, currency, fee, at }
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

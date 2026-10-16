import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { CurrencyCode, InstrumentRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { FxConversion } from '@/trading/kernel/market/market-capability'
import type { Book, LedgerEntryId } from '@/trading/kernel/operator/book'
import type { PageOptions } from '@/trading/kernel/store/page'

// `loss` is money the book lost before it started keeping records — the closed trades a
// snapshot import can only state as a total. It leaves cash like a fee but is not one: a fee is a
// cost of trading, this is the trading result. Neither touches net deposits, so both leave the
// return measured against what the operator actually contributed.
export const CASH_TXN_KINDS = Object.freeze(['deposit', 'withdrawal', 'fee', 'loss'] as const)
export const TRADE_TXN_KINDS = Object.freeze(['buy', 'sell', 'rights'] as const)
export const QUANTITY_TXN_KINDS = Object.freeze(['split', 'distribution'] as const)
/** Which leg of a resting exit filled. Absent on every operator-driven sale — a sell typed into
 *  /trade or /record is the operator's decision, and only a triggered exit has a leg to name. */
export const CLOSE_REASONS = Object.freeze(['stop', 'target'] as const)
export type CloseReason = (typeof CLOSE_REASONS)[number]
export const TRANSFER_TXN_KIND = 'transfer'

type CashTxnKind = (typeof CASH_TXN_KINDS)[number]
type TradeTxnKind = (typeof TRADE_TXN_KINDS)[number]
type QuantityTxnKind = (typeof QUANTITY_TXN_KINDS)[number]

export const LEDGER_TXN_KINDS = Object.freeze([
  ...CASH_TXN_KINDS,
  ...TRADE_TXN_KINDS,
  ...QUANTITY_TXN_KINDS,
  'dividend',
  TRANSFER_TXN_KIND,
] as const)
export type LedgerTxnKind = (typeof LEDGER_TXN_KINDS)[number]

/** The whole settled position, in the quantity slot a count would occupy. */
export const SELL_ALL = 'all'

/** Where a stored trade row's figures came from. `venue` is the whole row. `venueSized` is the
 *  venue's quantity and price against a fee the operator stated, which is never overridden. */
export type FillSource = 'venue' | 'venueSized' | 'venuePriced' | 'operator'

interface LedgerTxnDraftBase {
  readonly at: TradingDay
  readonly note?: string
}

/** The token that ends a row with the rate it converted at, and the word that accepts the day's
 *  market rate instead. */
export const FX_TOKEN = 'fx'
export const FX_AUTO = 'auto'

interface MonetaryLedgerTxnDraftBase extends LedgerTxnDraftBase {
  readonly currency: CurrencyCode
  /** Base-currency units per unit of `currency`, as the operator paid it. */
  readonly operatorFxRate?: number
  /** The operator accepted the day's market rate for a row in another currency. */
  readonly fxRateConfirmed?: true
  /** The market rate a held row was previewed at, so its confirm books the figures it showed. */
  readonly previewedConversion?: FxConversion
}

/** An instrument and the venue holding it. A cash row names a venue too, but no instrument — money
 *  sits at a custodian without being any particular thing. */
export interface HeldInstrument {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
}

export interface CashTxnDraft extends MonetaryLedgerTxnDraftBase {
  readonly kind: CashTxnKind
  readonly venue: VenueRef
  readonly amount: number
}

/** Cash moving between two of the operator's own venues. It is not a deposit or a withdrawal —
 *  nothing entered or left the book — so `netDepositsBase` does not move and the return stays
 *  measured against what was actually contributed. The fee is charged at the source. */
export interface TransferTxnDraft extends MonetaryLedgerTxnDraftBase {
  readonly kind: typeof TRANSFER_TXN_KIND
  readonly fromVenue: VenueRef
  readonly venue: VenueRef
  readonly amount: number
  readonly fee: number
}

export interface TradeTxnDraft extends MonetaryLedgerTxnDraftBase, HeldInstrument {
  readonly kind: TradeTxnKind
  readonly quantity: number
  readonly unitPrice: number
  readonly fee: number
  readonly closeReason?: CloseReason
}

/** The recorded shape with the fee left out. A market with a configured rate fills it during
 *  resolution, so a stored row always carries one. */
export type TradeTxnDraftInput = Omit<TradeTxnDraft, 'fee'> & { readonly fee?: number }

export interface DividendTxnDraft extends MonetaryLedgerTxnDraftBase, HeldInstrument {
  readonly kind: 'dividend'
  readonly amount: number
}

interface QuantityAdjustmentTxnDraft extends LedgerTxnDraftBase, HeldInstrument {
  readonly kind: QuantityTxnKind
  readonly quantityDelta: number
}

export type LedgerTxnDraft =
  | CashTxnDraft
  | TradeTxnDraft
  | DividendTxnDraft
  | QuantityAdjustmentTxnDraft
  | TransferTxnDraft

/** Closing out, where the size is the book's answer rather than the operator's. Stated as an
 *  instruction and resolved to a quantity before anything is stored, so a recorded row stays a plain
 *  sell and an in-place correction to an earlier row cannot re-base what this one meant. */
interface SellAllDraft extends MonetaryLedgerTxnDraftBase, HeldInstrument {
  readonly kind: 'sell'
  readonly quantity: typeof SELL_ALL
  readonly unitPrice: number
  readonly fee?: number
}

/** What a write boundary accepts. Only `record` takes it: an edit names a row that already carries
 *  a quantity and a fee, and re-resolving either against a later book or a changed rate would
 *  silently move a settled figure. */
export type LedgerTxnDraftInput =
  | CashTxnDraft
  | TradeTxnDraftInput
  | SellAllDraft
  | DividendTxnDraft
  | QuantityAdjustmentTxnDraft
  | TransferTxnDraft

export function isSellAllDraft(draft: LedgerTxnDraftInput): draft is SellAllDraft {
  return 'quantity' in draft && draft.quantity === SELL_ALL
}

type Resolved<T extends LedgerTxnDraftBase> = Omit<
  T,
  'operatorFxRate' | 'fxRateConfirmed' | 'previewedConversion'
> & {
  readonly settledAt: TradingDay
}

type Monetary<T> = T & { readonly conversion: FxConversion }

export type CashTxn = Monetary<Resolved<CashTxnDraft>>
export type TradeTxn = Monetary<Resolved<TradeTxnDraft>>
export type DividendTxn = Monetary<Resolved<DividendTxnDraft>>
export type QuantityAdjustmentTxn = Resolved<QuantityAdjustmentTxnDraft>
export type TransferTxn = Monetary<Resolved<TransferTxnDraft>>

export type LedgerTxn = CashTxn | TradeTxn | DividendTxn | QuantityAdjustmentTxn | TransferTxn

/** The kinds that move cash. The quantity adjustments are the rest of `LedgerTxn`. */
export type MonetaryTxn = CashTxn | TradeTxn | DividendTxn | TransferTxn

/** A recorded transaction as it stands now. `recordedAt` is when the row was first written and
 *  `updatedAt` when it was last edited — both instants, distinct from the transaction's own
 *  trading day. */
export interface LedgerEntry {
  readonly id: LedgerEntryId
  readonly recordedAt: number
  readonly updatedAt?: number
  readonly transaction: LedgerTxn
}

/** An insert plus the replay guard: the same key carrying different content is a caller bug, not a
 *  retry. Updates and deletes name a row by id and need no key of their own. */
export interface LedgerInsert {
  readonly entry: LedgerEntry
  readonly idempotencyKey: string
  readonly requestFingerprint: string
}

/** UUIDv7 leads with a timestamp, so entries recorded together share their opening characters — a
 *  handle has to come off the random tail to tell them apart. Short enough to type back from a chat
 *  line, and every write resolves it against the whole ledger rather than trusting it to be unique. */
const HANDLE_LENGTH = 6

export function ledgerEntryHandle(id: LedgerEntryId): string {
  return id.slice(-HANDLE_LENGTH)
}

/** The trading days a history read keeps, both ends inclusive. An absent end leaves that side
 *  open. */
export interface LedgerDayRange {
  readonly fromDay?: TradingDay
  readonly toDay?: TradingDay
}

export interface LedgerPageOptions extends PageOptions<LedgerEntryId> {
  readonly range?: LedgerDayRange
  /** One name's rows only; cash rows carry no instrument, so they drop out. */
  readonly instrument?: InstrumentRef
}

export interface LedgerEntryView {
  readonly id: LedgerEntryId
  readonly transactionKind: LedgerTxn['kind']
  readonly at: TradingDay
  readonly settledAt: TradingDay
  readonly instrument?: InstrumentRef
  /** The one operator-authored field the agent-facing view carries. It says why an entry exists —
   *  an imported balancing fee is not a brokerage charge — and no amount rides in on it. */
  readonly note?: string
  /** Absent until the row is first edited. */
  readonly updatedAt?: number
}

/** Which write happened, the row as it now stands, and the book the write produced. The book rides
 *  along because the ledger is the only source of truth and every write re-folds all of it: a
 *  confirmation that shows only the row leaves the operator to run `/portfolio` to find out what
 *  they just did. Folded inside the service, from the same rows the validator checked, so no
 *  command becomes a second owner of that arithmetic. */
export interface LedgerWriteResult {
  readonly kind: 'recorded' | 'updated' | 'deleted'
  readonly entry: LedgerEntry
  readonly book: Book
  /** Where the row's figures came from, so the confirmation never reads a venue's figure as one the
   *  operator typed. Absent on an edit and a delete, which resolve nothing. */
  readonly fillSource?: FillSource
  /** An existing row holding this one's exact content. Reported, never refused: the same size
   *  traded twice in a day is real, and only the operator knows which this was. */
  readonly duplicateOf?: LedgerEntryId
  /** The key already held this row, written by an earlier request or another writer: nothing new
   *  was booked. */
  readonly replayed?: true
  /** The levels-only hold a recorded buy earned, written by the same call that wrote the row.
   *  Absent on every other write, and on a buy a standing plan already covers. */
  readonly planned?: StoredSuggestion
}

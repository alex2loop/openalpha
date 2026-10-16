import type { FoldState } from '@/trading/features/ledger/fold-state'
import type {
  CashTxn,
  DividendTxn,
  LedgerEntry,
  LedgerTxn,
  MonetaryTxn,
  QuantityAdjustmentTxn,
  TradeTxn,
  TransferTxn,
} from '@/trading/features/ledger/types'
import type { CurrencyCode, InstrumentRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { Book, PendingCash, Position } from '@/trading/kernel/operator/book'
import { ValidationError } from '@/core/errors'
import {
  applyCurrencyCashTxn,
  currencyCashAt,
  isCurrencyCashRow,
  movesCurrencyCash,
  receiveCurrencyCash,
  spendCurrencyCash,
  toCurrencyCash,
} from '@/trading/features/ledger/currency-cash'
import { createFoldState, moveVenueCash } from '@/trading/features/ledger/fold-state'
import {
  clearFlatPosition,
  consumeLots,
  isClosingSale,
  type MutablePosition,
  QUANTITY_EPSILON,
  sellShare,
  settledQuantityAt,
} from '@/trading/features/ledger/position'
import { buildPositionKey } from '@/trading/kernel/instrument'
import { venueParam } from '@/trading/render/format'

/** Precondition: `transactions` arrives through `orderLedger` — the store returns rows unordered and
 *  an edit can move an entry's day — and has already passed `assertLedgerValid`, so a sell never
 *  exceeds settled quantity here. The fold carries no defensive re-check. */
export function foldBook(
  transactions: readonly LedgerEntry[],
  asOf: TradingDay,
  baseCurrency: CurrencyCode
): Book {
  const state = createFoldState(baseCurrency)

  for (const entry of transactions) {
    // Valid only because `orderLedger` sorted by day: once one entry is past asOf, every later one
    // is too, so `break` — not `continue` — is safe.
    if (entry.transaction.at > asOf) {
      break
    }

    assertRecordedInBase(entry, baseCurrency)
    applyTransaction(state, entry)
  }

  promoteSettled(state, asOf)

  return {
    asOf,
    baseCurrency,
    cashBase: state.cashBase,
    availableCashBase: state.availableCashBase,
    netDepositsBase: state.netDepositsBase,
    cashByVenue: new Map(state.byVenue),
    currencyCash: toCurrencyCash(state),
    pendingCash: state.pending,
    positions: [...state.positions.values()]
      .filter((position) => position.quantity > QUANTITY_EPSILON)
      .map((position) => toPosition(position, asOf)),
    sales: state.sales,
  }
}

/** Every `*Base` sum is a stored conversion applied, and a row converts to the base in force when it
 *  was recorded. Folding under another base would add two currencies together, so the mismatch is
 *  refused — re-deriving the rates would restate settled history at today's FX. A quantity
 *  adjustment moves no money and carries no conversion. */
function assertRecordedInBase(entry: LedgerEntry, baseCurrency: CurrencyCode): void {
  const txn = entry.transaction

  if (!('conversion' in txn)) {
    return
  }

  if (txn.conversion.toCurrency !== baseCurrency) {
    throw new ValidationError(
      `ledger entry ${entry.id} was recorded against base currency ${txn.conversion.toCurrency}, but the book base currency is ${baseCurrency}`
    )
  }
}

export function applyTransaction(state: FoldState, entry: LedgerEntry): void {
  const txn = entry.transaction

  if (isCurrencyCashRow(txn) && movesCurrencyCash(state, txn)) {
    applyCurrencyCashTxn(state, txn)

    return
  }

  switch (txn.kind) {
    case 'buy':
    case 'rights':
      applyBuy(state, entry, txn)

      return
    case 'sell':
      applySell(state, entry, txn)

      return
    case 'split':
    case 'distribution':
      applyQuantityAdjustment(state, txn)

      return
    case 'transfer':
      applyTransfer(state, txn)

      return
    default:
      applyCashTxn(state, entry, txn)
  }
}

/** What one row does to cash, in the transaction's own currency. The sole owner of this
 *  arithmetic: the appliers below and every page summary read it rather than restating it. A buy
 *  capitalizes its fee into what leaves the account; a sell nets it out of what arrives. */
function cashDeltaNative(txn: MonetaryTxn): number {
  // Only the fee leaves the book: the amount changes custodian, which the per-venue buckets carry.
  if (txn.kind === 'transfer') {
    return -txn.fee
  }

  if ('amount' in txn) {
    return txn.kind === 'deposit' || txn.kind === 'dividend' ? txn.amount : -txn.amount
  }

  const gross = txn.quantity * txn.unitPrice

  return txn.kind === 'sell' ? gross - txn.fee : -(gross + txn.fee)
}

/** Narrowed by shape, like `renderTxnDetail`: a quantity adjustment carries no conversion and moves
 *  no money. Each row converts at its own rate, which is what a page summary states; a row paid
 *  from currency cash moved the book by that cash's average cost instead. */
export function cashDeltaBase(txn: LedgerTxn): number {
  return 'conversion' in txn ? cashDeltaNative(txn) * txn.conversion.rate : 0
}

/** Money in becomes spendable only when it clears. Buys never pass through here: they commit cash
 *  at the trade day, which is what closes the unsettled double-spend. */
export function promoteSettled(state: FoldState, asOf: TradingDay): void {
  state.pending = state.pending.filter((row) => {
    if (row.availableAt > asOf) {
      return true
    }

    state.availableCashBase += row.amountBase
    moveVenueCash(state, row.venue, { cash: 0, available: row.amountBase })

    if (row.currency !== state.baseCurrency) {
      const held = currencyCashAt(state, row.venue, row.currency)

      if (held !== undefined) {
        held.available += row.amount
      }
    }

    return false
  })
}

/** Settled quantity is derived from lot settlement rather than tracked, so a split that scales
 *  every lot scales the sellable count with it and the two can never disagree. */
export function positionAt(
  state: FoldState,
  instrument: InstrumentRef,
  venue: VenueRef
): MutablePosition | undefined {
  return state.positions.get(buildPositionKey(instrument, venue))
}

function applyBuy(state: FoldState, entry: LedgerEntry, txn: TradeTxn): void {
  const position = positionFor(state, txn)
  const costNative = -cashDeltaNative(txn)
  const costBase = payForBuy(state, txn, costNative)

  if (position.quantity === 0) {
    position.cycleSoldQuantity = 0
    position.cycleBuys = []
  }

  position.cycleBuys.push({
    acquiredAt: txn.at,
    heldBefore: position.quantity,
    soldBefore: position.cycleSoldQuantity,
  })

  // Fees are part of cost basis, so a round trip at the same price is a loss — which it is.
  position.quantity += txn.quantity
  position.costBasisNative += costNative
  position.costBasisBase += costBase
  position.costBasisFeesNative += txn.fee
  position.costBasisFeesBase += costNative === 0 ? 0 : txn.fee * (costBase / costNative)
  position.lots.push({
    entryId: entry.id,
    acquiredAt: txn.at,
    settledAt: txn.settledAt,
    quantity: txn.quantity,
    remainingQuantity: txn.quantity,
  })
}

/** What a buy cost in the base: the venue's currency cash at its average cost when it holds that
 *  currency, the row's own rate otherwise. Committed now, not at settlement: this is the debit that
 *  closes the unsettled double-spend. */
function payForBuy(state: FoldState, txn: TradeTxn, costNative: number): number {
  const held = currencyCashAt(state, txn.venue, txn.currency)
  const costBase =
    held === undefined ? costNative * txn.conversion.rate : spendCurrencyCash(held, costNative)

  state.cashBase -= costBase
  state.availableCashBase -= costBase
  moveVenueCash(state, txn.venue, { cash: -costBase, available: -costBase })

  return costBase
}

function applySell(state: FoldState, entry: LedgerEntry, txn: TradeTxn): void {
  const position = positionFor(state, txn)
  const closing = isClosingSale(position.quantity, txn.quantity)
  const share = sellShare(position, txn.quantity, closing)
  const basisReleasedNative = position.costBasisNative * share
  const proceedsNative = cashDeltaNative(txn)
  const proceedsBase = cashDeltaBase(txn)

  const basisReleasedBase = position.costBasisBase * share

  position.quantity -= txn.quantity
  position.cycleSoldQuantity += txn.quantity
  // The sale's own fee is netted out of the proceeds above, never capitalized into what is left.
  position.costBasisNative -= basisReleasedNative
  position.costBasisBase -= basisReleasedBase
  position.costBasisFeesNative -= position.costBasisFeesNative * share
  position.costBasisFeesBase -= position.costBasisFeesBase * share

  // Snap the dust float subtraction leaves behind: a residual quantity a later sell's share would
  // divide against, and a residual basis the next buy would average its own cost into. A closing
  // sale leaves its overshoot behind the same way, as a negative every surface would print as a
  // short and the next buy would average against.
  if (closing || Math.abs(position.quantity) <= QUANTITY_EPSILON) {
    clearFlatPosition(position)
  }

  state.cashBase += proceedsBase
  moveVenueCash(state, txn.venue, { cash: proceedsBase, available: 0 })

  const held = currencyCashAt(state, txn.venue, txn.currency)

  if (held !== undefined) {
    receiveCurrencyCash(held, { amount: proceedsNative, costBase: proceedsBase })
  }

  state.pending.push(
    pendingCash(entry, txn, {
      currency: held === undefined ? state.baseCurrency : txn.currency,
      amount: held === undefined ? proceedsBase : proceedsNative,
      amountBase: proceedsBase,
    })
  )
  consumeLots(position, txn.quantity)
  state.sales.push({
    instrument: txn.instrument,
    venue: txn.venue,
    at: txn.at,
    unitPriceNative: txn.unitPrice,
    proceedsNative,
    basisReleasedNative,
    realizedBase: proceedsBase - basisReleasedBase,
    remainingQuantity: position.quantity,
  })
}

/** Flat means flat: a basis left standing against no shares reappears in the next cycle's average
 *  price, and a quantity does in the next sale's pro-rata share. */
function applyCashTxn(state: FoldState, entry: LedgerEntry, txn: CashTxn | DividendTxn): void {
  const delta = cashDeltaBase(txn)

  state.cashBase += delta
  moveVenueCash(state, txn.venue, { cash: delta, available: 0 })
  // A withdrawal routes through the same pending path as an inflow rather than debiting available
  // cash directly the way a buy does. That is correct only because a cash kind's settledAt always
  // equals its at, so promoteSettled clears it on the same pass. If cash settlement ever gains a
  // lag, a withdrawal must debit availableCashBase at the trade day.
  state.pending.push(
    pendingCash(entry, txn, { currency: state.baseCurrency, amount: delta, amountBase: delta })
  )

  // A dividend and a fee move cash without changing what the operator put in or took out.
  if (txn.kind === 'deposit' || txn.kind === 'withdrawal') {
    state.netDepositsBase += delta
  }
}

function applyTransfer(state: FoldState, txn: TransferTxn): void {
  const amountBase = txn.amount * txn.conversion.rate
  const feeBase = -cashDeltaBase(txn)
  const leaving = amountBase + feeBase

  state.cashBase -= feeBase
  state.availableCashBase -= feeBase
  moveVenueCash(state, txn.fromVenue, { cash: -leaving, available: -leaving })
  moveVenueCash(state, txn.venue, { cash: amountBase, available: amountBase })
}

/** Shares arrive at zero cost and basis is untouched, so a 2:1 split doubles the count and halves
 *  the average — which is what it should do. */
function applyQuantityAdjustment(state: FoldState, txn: QuantityAdjustmentTxn): void {
  const position = positionAt(state, txn.instrument, txn.venue)

  if (!position || position.quantity <= QUANTITY_EPSILON) {
    throw new ValidationError(
      `quantity adjustment for a position that does not exist: ` +
        `${txn.instrument.ticker} at ${txn.venue}`,
      {
        key: 'errors.ledgerAdjustmentUnheld',
        params: { ticker: txn.instrument.ticker, venue: venueParam(txn.venue) },
      }
    )
  }

  if (position.quantity + txn.quantityDelta <= 0) {
    throw new ValidationError(
      `quantity adjustment reduces ${txn.instrument.ticker} at ${txn.venue} to zero or below`,
      {
        key: 'errors.ledgerAdjustmentBelowZero',
        params: { ticker: txn.instrument.ticker, venue: venueParam(txn.venue) },
      }
    )
  }

  // Every open lot scales by the same factor, keeping lot-level settlement aligned: adding the
  // delta to settled holdings alone would make shares issued against unsettled lots sellable.
  const factor = (position.quantity + txn.quantityDelta) / position.quantity

  position.quantity += txn.quantityDelta
  position.cycleSoldQuantity *= factor
  position.cycleBuys = position.cycleBuys.map((buy) => ({
    ...buy,
    heldBefore: buy.heldBefore * factor,
    soldBefore: buy.soldBefore * factor,
  }))

  for (const lot of position.lots) {
    lot.quantity *= factor
    lot.remainingQuantity *= factor
  }
}

function positionFor(state: FoldState, txn: TradeTxn): MutablePosition {
  const key = buildPositionKey(txn.instrument, txn.venue)
  const existing = state.positions.get(key)

  if (existing) {
    return existing
  }

  const created: MutablePosition = {
    instrument: txn.instrument,
    venue: txn.venue,
    currency: txn.currency,
    quantity: 0,
    costBasisNative: 0,
    costBasisBase: 0,
    costBasisFeesNative: 0,
    costBasisFeesBase: 0,
    cycleSoldQuantity: 0,
    cycleBuys: [],
    lots: [],
  }

  state.positions.set(key, created)

  return created
}

function pendingCash(
  entry: LedgerEntry,
  txn: MonetaryTxn,
  landing: Pick<PendingCash, 'currency' | 'amount' | 'amountBase'>
): PendingCash {
  return {
    entryId: entry.id,
    venue: txn.venue,
    availableAt: txn.settledAt,
    ...landing,
  }
}

function toPosition(position: MutablePosition, asOf: TradingDay): Position {
  return {
    instrument: position.instrument,
    venue: position.venue,
    currency: position.currency,
    quantity: position.quantity,
    settledQuantity: settledQuantityAt(position, asOf),
    costBasisNative: position.costBasisNative,
    costBasisBase: position.costBasisBase,
    costBasisFeesNative: position.costBasisFeesNative,
    costBasisFeesBase: position.costBasisFeesBase,
    soldQuantity: position.cycleSoldQuantity,
    buys: [...position.cycleBuys],
    lots: position.lots
      .filter((lot) => lot.remainingQuantity > QUANTITY_EPSILON)
      .map((lot) => ({ ...lot })),
  }
}

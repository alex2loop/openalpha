import type { FoldState, MutableCurrencyCash } from '@/trading/features/ledger/fold-state'
import type { CashTxn, DividendTxn, LedgerTxn, TransferTxn } from '@/trading/features/ledger/types'
import type { CurrencyCode, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { CurrencyCash } from '@/trading/kernel/operator/book'
import { moveVenueCash } from '@/trading/features/ledger/fold-state'
import { QUANTITY_EPSILON } from '@/trading/features/ledger/position'

/** What a row spends of one venue's currency cash. */
interface CurrencyCashSpend {
  readonly venue: VenueRef
  readonly currency: CurrencyCode
  readonly amount: number
}

export function currencyCashAt(
  state: FoldState,
  venue: VenueRef,
  currency: CurrencyCode
): MutableCurrencyCash | undefined {
  return state.currencyCash.get(currencyCashKey(venue, currency))
}

/** The rows currency cash applies whole. A trade only pays or is paid through it. */
export function isCurrencyCashRow(txn: LedgerTxn): txn is CashTxn | DividendTxn | TransferTxn {
  return 'currency' in txn && txn.kind !== 'buy' && txn.kind !== 'sell' && txn.kind !== 'rights'
}

/** A cash row in another currency always moves the venue's currency cash, opening it on the first
 *  inflow; a trade moves it once the venue holds that currency, and the base cash otherwise. */
export function movesCurrencyCash(state: FoldState, txn: LedgerTxn): boolean {
  if (!('currency' in txn) || txn.currency === state.baseCurrency) {
    return false
  }

  if (txn.kind === 'buy' || txn.kind === 'sell' || txn.kind === 'rights') {
    return currencyCashAt(state, txn.venue, txn.currency) !== undefined
  }

  return true
}

/** The currency-cash outflow a row needs before it applies; undefined when it spends base cash or
 *  nothing. */
export function currencyCashSpend(state: FoldState, txn: LedgerTxn): CurrencyCashSpend | undefined {
  if (!(movesCurrencyCash(state, txn) && 'currency' in txn)) {
    return undefined
  }

  switch (txn.kind) {
    case 'buy':
    case 'rights':
      return spend(txn.venue, txn.currency, txn.quantity * txn.unitPrice + txn.fee)
    case 'withdrawal':
    case 'fee':
    case 'loss':
      return spend(txn.venue, txn.currency, txn.amount)
    case 'transfer':
      return spend(txn.fromVenue, txn.currency, txn.amount + txn.fee)
    default:
      return undefined
  }
}

/** Spends at average cost and returns the base cost that leaves with the amount. */
export function spendCurrencyCash(cash: MutableCurrencyCash, amount: number): number {
  const costBase = cash.amount > 0 ? cash.costBase * (amount / cash.amount) : 0

  cash.amount -= amount
  cash.available -= amount
  cash.costBase -= costBase

  // Dust from float subtraction would be averaged into the next inflow's cost.
  if (Math.abs(cash.amount) <= QUANTITY_EPSILON) {
    cash.amount = 0
    cash.available = 0
    cash.costBase = 0
  }

  return costBase
}

/** Deposit, dividend and transfer in; withdrawal, fee and loss out. A deposit adds its base value
 *  to what the operator put in; a withdrawal takes out what it was worth that day, so the gap to
 *  its average cost lands in realized P/L through `netDepositsBase`. */
export function applyCurrencyCashTxn(
  state: FoldState,
  txn: CashTxn | DividendTxn | TransferTxn
): void {
  if (txn.kind === 'transfer') {
    transferCurrencyCash(state, txn)

    return
  }

  if (txn.kind === 'deposit' || txn.kind === 'dividend') {
    const costBase = txn.amount * txn.conversion.rate

    addCurrencyCash(state, {
      venue: txn.venue,
      currency: txn.currency,
      at: txn.at,
      amount: txn.amount,
      costBase,
    })

    if (txn.kind === 'deposit') {
      state.netDepositsBase += costBase
    }

    return
  }

  const held = currencyCashAt(state, txn.venue, txn.currency)
  const costBase = held === undefined ? 0 : spendCurrencyCash(held, txn.amount)

  debitBase(state, txn.venue, costBase)

  if (txn.kind === 'withdrawal') {
    state.netDepositsBase -= txn.amount * txn.conversion.rate
  }
}

/** A sale's proceeds return to the currency they were paid in, valued at the sale's own rate. */
export function receiveCurrencyCash(
  cash: MutableCurrencyCash,
  proceeds: { readonly amount: number; readonly costBase: number }
): void {
  cash.amount += proceeds.amount
  cash.costBase += proceeds.costBase
}

/** Zero ones included, so every reader agrees on which venues hold the currency. */
export function toCurrencyCash(state: FoldState): readonly CurrencyCash[] {
  return [...state.currencyCash.values()].map((cash) => ({ ...cash }))
}

/** What the venue's currency cash can spend now, at its average cost. Base-cash checks subtract it,
 *  so base cash never spends the venue's USDT. */
export function currencyCashAvailableBase(state: FoldState, venue: VenueRef): number {
  let total = 0

  for (const cash of state.currencyCash.values()) {
    if (cash.venue === venue && cash.amount > QUANTITY_EPSILON) {
      total += cash.costBase * (cash.available / cash.amount)
    }
  }

  return total
}

function transferCurrencyCash(state: FoldState, txn: TransferTxn): void {
  const source = currencyCashAt(state, txn.fromVenue, txn.currency)
  const leavingBase = source === undefined ? 0 : spendCurrencyCash(source, txn.amount + txn.fee)
  const feeBase = leavingBase * (txn.fee / (txn.amount + txn.fee))

  debitBase(state, txn.fromVenue, leavingBase)
  addCurrencyCash(state, {
    venue: txn.venue,
    currency: txn.currency,
    at: txn.at,
    amount: txn.amount,
    costBase: leavingBase - feeBase,
  })
}

function addCurrencyCash(
  state: FoldState,
  inflow: {
    venue: VenueRef
    currency: CurrencyCode
    at: TradingDay
    amount: number
    costBase: number
  }
): void {
  const key = currencyCashKey(inflow.venue, inflow.currency)
  // The fold runs in day order, so the inflow that creates the entry is its first.
  const held = state.currencyCash.get(key) ?? {
    venue: inflow.venue,
    currency: inflow.currency,
    openedAt: inflow.at,
    amount: 0,
    available: 0,
    costBase: 0,
  }

  held.amount += inflow.amount
  held.available += inflow.amount
  held.costBase += inflow.costBase
  state.currencyCash.set(key, held)
  state.cashBase += inflow.costBase
  state.availableCashBase += inflow.costBase
  moveVenueCash(state, inflow.venue, { cash: inflow.costBase, available: inflow.costBase })
}

function debitBase(state: FoldState, venue: VenueRef, costBase: number): void {
  state.cashBase -= costBase
  state.availableCashBase -= costBase
  moveVenueCash(state, venue, { cash: -costBase, available: -costBase })
}

function spend(venue: VenueRef, currency: CurrencyCode, amount: number): CurrencyCashSpend {
  return { venue, currency, amount }
}

function currencyCashKey(venue: VenueRef, currency: CurrencyCode): string {
  return `${venue}:${currency}`
}

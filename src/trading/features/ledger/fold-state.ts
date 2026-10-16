import type { MutablePosition } from '@/trading/features/ledger/position'
import type { CurrencyCode, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { PendingCash, SaleRecord, VenueCash } from '@/trading/kernel/operator/book'

export interface MutableCurrencyCash {
  readonly venue: VenueRef
  readonly currency: CurrencyCode
  readonly openedAt: TradingDay
  amount: number
  available: number
  costBase: number
}

/** Module-internal: `validate.ts` replays validation over the same state machine the fold uses, so
 *  "what is valid" can never drift from "what is computed". Nothing outside `ledger/` sees it. */
export interface FoldState {
  readonly baseCurrency: CurrencyCode
  readonly positions: Map<string, MutablePosition>
  readonly sales: SaleRecord[]
  readonly currencyCash: Map<string, MutableCurrencyCash>
  pending: PendingCash[]
  cashBase: number
  availableCashBase: number
  netDepositsBase: number
  byVenue: Map<VenueRef, VenueCash>
}

export function createFoldState(baseCurrency: CurrencyCode): FoldState {
  return {
    baseCurrency,
    positions: new Map(),
    sales: [],
    currencyCash: new Map(),
    pending: [],
    cashBase: 0,
    availableCashBase: 0,
    netDepositsBase: 0,
    byVenue: new Map(),
  }
}

export function moveVenueCash(state: FoldState, venue: VenueRef, delta: VenueCash): void {
  const current = state.byVenue.get(venue) ?? { cash: 0, available: 0 }

  state.byVenue.set(venue, {
    cash: current.cash + delta.cash,
    available: current.available + delta.available,
  })
}

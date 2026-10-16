import type { BrandTag } from '@/core/ids'
import type { CurrencyCode, InstrumentRef, TradingDay, VenueRef } from '@/trading/kernel/instrument'
import type { MarkKind } from '@/trading/kernel/market/market-data'
import { buildUuidV7Id, parseUuidV7Id } from '@/trading/kernel/instrument'

export interface PositionLot {
  readonly entryId: LedgerEntryId
  readonly acquiredAt: TradingDay
  readonly settledAt: TradingDay
  readonly quantity: number
  readonly remainingQuantity: number
}

/** What one buy of the open cycle landed on: the units already held and the units the cycle had
 *  sold by then. Kept after its lot is sold, because it is what dates the holding as it stands. */
export interface PositionBuy {
  readonly acquiredAt: TradingDay
  readonly heldBefore: number
  readonly soldBefore: number
}

export interface Position {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly currency: CurrencyCode
  readonly quantity: number
  readonly settledQuantity: number
  readonly costBasisNative: number
  readonly costBasisBase: number
  /** The fee share of the cost basis above, released pro rata by a sale exactly as the basis is.
   *  How much of `costBasis*` above is fee rather than fill, reported on its own. */
  readonly costBasisFeesNative: number
  readonly costBasisFeesBase: number
  /** Units sold since the position last opened from flat. Zero on one never trimmed. */
  readonly soldQuantity: number
  /** Every buy since the position last opened from flat, oldest first. */
  readonly buys: readonly PositionBuy[]
  readonly lots: readonly PositionLot[]
}

/** One sale as the fold booked it. Whether it closed the holding is decided against the venue's
 *  smallest order, which the fold cannot reach, so it records what each sale left behind. */
export interface SaleRecord {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly at: TradingDay
  readonly unitPriceNative: number
  /** After the sale's fee. */
  readonly proceedsNative: number
  readonly basisReleasedNative: number
  readonly realizedBase: number
  readonly remainingQuantity: number
}

/** One position carried from open to flat, or to a sliver below the venue's smallest order: what the whole cycle realized against the basis it
 *  released, and the sale that closed it. Keyed per instrument and venue exactly as a position is,
 *  because a cost basis is per custodian. */
export interface ClosedRoundTrip {
  readonly instrument: InstrumentRef
  readonly venue: VenueRef
  readonly closedAt: TradingDay
  /** The closing sale's price, in the market's own currency. */
  readonly exitPriceNative: number
  /** Proceeds over the basis they released, less one: negative is a loss. Fee-bearing on both legs,
   *  so a round trip at the same price reads as the small loss it is. */
  readonly realizedFraction: number
  /** What the round trip realized in the book's currency, both legs' fees included. */
  readonly realizedBase: number
}

export interface PendingCash {
  readonly entryId: LedgerEntryId
  readonly venue: VenueRef
  readonly availableAt: TradingDay
  /** Where the money lands: the base, or the venue's currency cash. */
  readonly currency: CurrencyCode
  /** In `currency`. */
  readonly amount: number
  readonly amountBase: number
}

/** Cash a venue holds in a currency other than the book's: USDT at an exchange. `costBase` is what
 *  it cost in the base, averaged over every inflow, so spending it carries that cost into what it
 *  buys and the rest of its value is currency movement. Once opened it stays, at zero if spent:
 *  the venue keeps paying for that currency's trades in it, and every reader asks this list. */
export interface CurrencyCash {
  readonly venue: VenueRef
  readonly currency: CurrencyCode
  /** The day of its first inflow: a row dated before it was paid in the base. */
  readonly openedAt: TradingDay
  readonly amount: number
  readonly available: number
  readonly costBase: number
}

/** One venue's cash. `cash` is everything booked there; `available` is what has cleared and can
 *  be spent today. They differ only while a sale is unsettled. */
export interface VenueCash {
  readonly cash: number
  readonly available: number
}

export interface Book {
  readonly asOf: TradingDay
  readonly baseCurrency: CurrencyCode
  readonly cashBase: number
  readonly availableCashBase: number
  readonly netDepositsBase: number
  /** Cash split by the venue holding it. The totals above stay the whole-book figures every
   *  NAV, return and reserve reading wants; this answers what a buy at one venue can reach. Each
   *  venue's figure includes its currency cash at cost, so every reader of reachable cash keeps
   *  working; a base-currency outflow is checked against the figure less that currency cash. */
  readonly cashByVenue: ReadonlyMap<VenueRef, VenueCash>
  readonly currencyCash: readonly CurrencyCash[]
  readonly pendingCash: readonly PendingCash[]
  readonly positions: readonly Position[]
  /** Every sale, in ledger order. */
  readonly sales: readonly SaleRecord[]
}

// One trade is one row, updated and deleted in place. An operator who mistypes a day fixes that
// day; nothing supersedes anything. The book is the fold over the rows as they stand right now, so
// a correction re-bases every reading taken from it, including past suggestions.
export type LedgerEntryId = string & BrandTag<'LedgerEntryId'>

export function ledgerEntryId(raw: string): LedgerEntryId {
  return parseUuidV7Id<LedgerEntryId>(raw, 'LedgerEntryId')
}

export function buildLedgerEntryId(now: number): LedgerEntryId {
  return buildUuidV7Id<LedgerEntryId>(now, 'LedgerEntryId')
}

/** How the prices behind a whole reading were taken. `day`/`time` describe the weakest priced leg:
 *  a book is only as settled as its least-settled holding. */
export interface PriceFreshness {
  readonly markKind: MarkKind
  readonly day: TradingDay
  /** The freshest leg's instant, present only when every priced leg is live: a mixed book has no
   *  single time to name. Carried as the instant so the clock reads in the operator's zone. */
  readonly observedAt?: number
}

/** Whether cash is spendable today or parked where it earns. The book folds it; the renderer prints
 *  it; neither owns the word. */
export const CASH_POSTURES = Object.freeze(['fully-liquid', 'term-deposit-eligible'] as const)
export type CashPosture = (typeof CASH_POSTURES)[number]

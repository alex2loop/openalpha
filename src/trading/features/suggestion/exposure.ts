import type { TradingDay } from '@/trading/kernel/instrument'

/** Where the book already stands on the name a suggestion is about. Neither module owns these: the
 *  ledger fold produces them, the debate reasons over them, and the stored row keeps what it held. */

/** What the book already holds of this name. Present only when it holds some. Ownership comes from
 *  the ledger fold, so it is known whenever the name is held; the weight needs a NAV the book may
 *  not have. */
export interface HeldPosition {
  readonly units: number
  /** Fee-bearing cost per unit, in the market's own currency, so it compares against the levels
   *  beside it rather than against the book's base. Stored rather than re-derived, because a
   *  re-rendered suggestion has the payload and not the book. */
  readonly unitCostNative: number
  readonly settledUnits: number
  /** How many separate buys the position is still made of, across every venue holding it. One is an
   *  entry; more than one means this add is a tranche, which is the fact that decides whether the
   *  debate is arguing an entry or an accumulation. */
  readonly openLotCount: number
  /** When the oldest surviving parcel was acquired. Absent only when the fold saw no open lot. */
  readonly firstAcquiredAt?: TradingDay
  /** When half of what is still held had been bought, which is how long the position has actually
   *  been waiting. Absent exactly when `firstAcquiredAt` is. */
  readonly medianAcquiredAt?: TradingDay
  readonly pctNav?: number
  /** The session the last unsettled unit becomes sellable. Absent once every unit is. */
  readonly settlesOn?: TradingDay
  /** Units already sold since the position opened. Absent when none were, so a plan that banks a
   *  first tranche can tell it has already been taken. */
  readonly soldUnits?: number
  /** The day the holding as it stands opened, which is what bounds the plans that can be its exit.
   *  Absent where the fold saw no buy. */
  readonly openedOn?: TradingDay
}

/** One sleeve's weight against the cap it is measured by. */
export interface SleeveExposure {
  readonly name: string
  readonly pctNav: number
  readonly capPctNav: number
}

/** What the operator's own closed round trips in this name say, as much of it as a deciding role
 *  may know: how many, and whether the last one ended at a gain or a loss. No return, exit price or
 *  quantity — the same reason the rest of this type is weights only. */
export interface RoundTripHistory {
  readonly count: number
  readonly lastClosedAt: TradingDay
  readonly lastResult: 'gain' | 'loss'
}

/** Where the book stands on an idea before acting on it: this name and its sector. Weights only —
 *  the deciding roles reason in weights and the sizer enforces in weights. */
export interface BookExposure {
  readonly held?: HeldPosition
  readonly sector?: SleeveExposure
  /** Absent when the operator has not closed this name inside the re-entry window. */
  readonly roundTrips?: RoundTripHistory
}

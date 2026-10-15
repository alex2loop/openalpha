import type { Caveat } from '@/trading/kernel/caveat'
import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSeriesId } from '@/trading/kernel/market/macro-series'
import type { MarketRegime } from '@/trading/kernel/market/market-data'
import type { SourceProvenance } from '@/trading/kernel/source/source-result'

export type MacroMissingReason = 'no-observation' | 'observation-only' | 'fetch-error'

export interface MissingMacroDriver {
  readonly id: MacroSeriesId
  readonly reason: MacroMissingReason
  /** FRED's most recent published date for this series when one exists; the renderer uses it to say
   *  "FRED last published X" rather than leaving the reader to assume "no data today". */
  readonly lastObservationAt?: TradingDay
}

export interface MacroRiskView {
  readonly region: Region
  readonly asOf: TradingDay
  readonly regime: MarketRegime
  /** The regime the composite alone implies. Differs from `regime` when a market lowered it, and a
   *  lowered read that never says so reads as the formula disagreeing with itself. */
  readonly scoreRegime: MarketRegime
  readonly score: number
  /** Share of the model's total weight that had a reading today, as a fraction. */
  readonly coverage: number
  readonly formulaVersion: string
  readonly drivers: readonly MacroRiskDriver[]
  /** Weighted series with no reading today. Absent from `drivers`, named here with a reason, because
   *  "did not vote" and "voted neutral" are different facts, and so is "no observation today" vs.
   *  "fetch failed". */
  readonly missing: readonly MissingMacroDriver[]
  readonly provenance: readonly SourceProvenance[]
  readonly caveats: readonly Caveat[]
}

/** What a driver's value and its band anchors are read in. A rate is a percentage; an index is a
 *  level against its own base year, and a percent sign on it states a denomination it does not
 *  have. */
export type MacroUnit = 'percent' | 'level'

export interface MacroRiskDriver {
  readonly id: MacroSeriesId
  readonly unit: MacroUnit
  readonly value: number
  /** The trading day this driver was actually observed on, not the day the composite asks about.
   *  FRED publishes DGS10 with a one-day lag, so the two diverge most weekdays. */
  readonly asOf: TradingDay
  /** Share of the vote actually cast, not the declared weight: a driver with no reading today does
   *  not vote, and the composite is renormalized over the rest. Published weights therefore sum to
   *  one across `drivers`, and `coverage` is where partial data is reported. */
  readonly weight: number
  /** The band anchors this reading was scored against, in the series' own units. */
  readonly bearishAt: number
  readonly bullishAt: number
  /** How much this driver moved the reported composite. Published contributions sum to `score`. */
  readonly contribution: number
}

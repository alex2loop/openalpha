import type { TradingDay } from '@/trading/kernel/instrument'

export const TAPE_SIGNALS = Object.freeze(['foreign-flip', 'washout-held', 'leverage-led'] as const)
export type TapeSignal = (typeof TAPE_SIGNALS)[number]

/** What one session's tape said about a name, beyond its factors. Shared by every market that
 *  publishes such a read, so the factor log and the stages speak one vocabulary. */
export interface TapeReading {
  readonly signal: TapeSignal
  readonly day: TradingDay
  /** The signal's own magnitude: a share of turnover, a relative volume, or a change in open
   *  interest, as the signal declares. */
  readonly measure: number
  /** The move the signal fires against, as a signed fraction. */
  readonly run: number
}

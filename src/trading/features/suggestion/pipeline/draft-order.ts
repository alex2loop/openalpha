import type { FinalizeInput } from '@/trading/features/suggestion/pipeline/types'
import type {
  ActionableSuggestion,
  PriceBandNote,
  SettlementNote,
  Suggestion,
} from '@/trading/features/suggestion/types'
import type { DailyPriceBand, TradingDay } from '@/trading/kernel/instrument'

/** `worstCaseDrawdownPct` is percent-valued, so a 6% fall reads "6" not "0.06". */
const PERCENT_PER_UNIT = 100

/** The limit stands for the order session and the ones after it the policy counts. */
export function restingEntryField(
  input: Pick<FinalizeInput, 'levels' | 'manifest'>,
  orderSession: TradingDay
): Pick<ActionableSuggestion, 'restingEntry'> {
  const resting = input.levels?.resting

  if (resting === undefined) {
    return {}
  }

  return {
    restingEntry: {
      run: resting.run,
      runSessions: resting.runSessions,
      until: input.manifest.calendar.addTradingDays(orderSession, resting.validSessions - 1),
    },
  }
}

/** Only a buy locks the operator in; a reduce sells what is already settled. The fill session, every
 *  locked session after it and the first sellable one each open under a fresh band before a sale can
 *  print, so the floor compounds over one band more than the settlement count: HOSE's T+2 shares
 *  land at midday, after the morning of the sellable session has already traded. */
export function resolveSettlementNote(
  draft: Suggestion,
  input: Pick<FinalizeInput, 'manifest' | 'dailyBand'>,
  orderSession: TradingDay
): SettlementNote | undefined {
  const { manifest, dailyBand: band } = input
  const sessions = manifest.settlementSessions

  if (draft.action !== 'buy' || sessions <= 0 || band === undefined) {
    return undefined
  }

  return {
    sellableFrom: manifest.calendar.addTradingDays(orderSession, sessions),
    worstCaseDrawdownPct:
      (1 - (1 - band.policy.maximumDownPct) ** (sessions + 1)) * PERCENT_PER_UNIT,
  }
}

/** The prices the venue will not let this name trade outside of in the order's session, copied
 *  from the band the market resolved. Both bounds and both limits travel, because a venue whose up
 *  and down limits differ makes a single ± wrong. */
export function priceBandOf(band: DailyPriceBand): PriceBandNote {
  return {
    floor: band.floor,
    ceiling: band.ceiling,
    maximumUpPct: band.policy.maximumUpPct,
    maximumDownPct: band.policy.maximumDownPct,
  }
}

import type { DailyTradeSides } from '@/trading/kernel/market/market-data'
import { TRADE_SIDES_MINIMUM_VOLUME } from '@/trading/markets/equity-vn/policy'

/** Where the session sat between all-selling and all-buying, in [-1, 1]. Absent when the session
 *  was too thin to read or classified nothing: one owner, so no caller invents a second denominator
 *  by folding the auction prints back in. */
export function aggressorBalance(snapshot: DailyTradeSides): number | undefined {
  const classified = snapshot.buyVolume + snapshot.sellVolume

  if (classified < TRADE_SIDES_MINIMUM_VOLUME) {
    return undefined
  }

  return (snapshot.buyVolume - snapshot.sellVolume) / classified
}

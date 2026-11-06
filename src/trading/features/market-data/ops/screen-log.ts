import type { Logger } from '@/core/logging/logger'
import type { MarketDataScreenRequest } from '@/trading/features/market-data/types'
import type { ScreenResult } from '@/trading/kernel/market/market-capability'
import { countByGate } from '@/trading/markets/screen-partition'

/** Enough to carry every name a crypto screen examines, so its board is always fully explained.
 *  A VN screen gates its whole universe and truncates; the counts still cover all of it. */
const SCREEN_LOG_REJECTIONS = 40

/** Which names cleared the gates and which gate stopped each of the rest. Two runs minutes apart
 *  can return different boards, and without the per-name verdict there is no telling a market that
 *  moved from a screen that changed. */
export function logScreen(
  logger: Logger,
  options: Pick<MarketDataScreenRequest, 'market' | 'limit'>,
  result: ScreenResult
): void {
  const omitted = result.rejections.length - SCREEN_LOG_REJECTIONS

  logger.debug('trading.screen_completed', {
    market: options.market,
    // The board is truncated to this before anyone sees it, so a shorter board than the survivor
    // count explains itself only when the cap that cut it is on the same line.
    limit: options.limit,
    asOf: result.asOf,
    universeSize: result.universeSize,
    ...(result.bandCounts === undefined ? {} : { bandCounts: result.bandCounts }),
    candidates: result.candidates.map((candidate) => candidate.instrument.ticker),
    rejectedByGate: countByGate(result.rejections),
    rejected: result.rejections
      .slice(0, SCREEN_LOG_REJECTIONS)
      .map((rejection) => `${rejection.instrument.ticker}:${rejection.code}`),
    ...(omitted > 0 ? { rejectedOmitted: omitted } : {}),
  })
}

import type { Market } from '@/trading/markets/types'

/** Whether a suggestion on this market can ever have its outcome scored. Stops and targets are in
 *  the market's own quote; a reference series is not, so comparing the two resolves every row on
 *  its first bar. A market that fails this leaves its rows pending forever, which is the right
 *  answer and the reason the report has to say so. */
export function canResolveOutcomes(market: Market): boolean {
  return market.capabilities.bars !== undefined && market.manifest.referenceBarsOnly !== true
}

import type { CalibrationBucket } from '@/trading/features/suggestion/track-record/calibration'
import type { ConvictionBand } from '@/trading/kernel/conviction'
import type { UserProfile } from '@/trading/kernel/operator/profile'
import { CONVICTION_SIZING_SCALE } from '@/trading/kernel/conviction'

/** Quarter Kelly. Full Kelly maximizes growth only if the win rate is exact, and a rate over a few
 *  dozen rows is not. Fractional Kelly pays `2c - c²` of the maximum growth rate, so a quarter buys
 *  its quarter of the drawdown for 44% of the growth. */
const KELLY_FRACTION = 0.25

/** A band with a losing record is sized as a low-conviction call, never as nothing: a floor of
 *  zero would hold every buy in the band, and a hold is never scored, so the band could never earn
 *  its way back. */
const SCALE_FLOOR = CONVICTION_SIZING_SCALE.low

/** A realized scale carries the sample it was read off, because the row states it. A policy scale
 *  has none to state - that is what makes it the policy one. */
export type SizingScale =
  | { readonly source: 'policy'; readonly scale: number }
  | { readonly source: 'realized'; readonly scale: number; readonly resolvedCount: number }

interface SizingScaleInput {
  readonly conviction: ConvictionBand
  readonly bucket?: CalibrationBucket
  readonly profile: Pick<UserProfile, 'riskPerTradePctNav'>
}

/** The Kelly-implied share of NAV to risk on a trade in this band, divided by what the operator
 *  already risks per trade, and never above the band's own multiplier. A band the record cannot
 *  rate keeps that multiplier untouched.
 *
 *  Capped rather than substituted, because the estimate is not good enough to size up on: the
 *  record rates a band at twenty resolved rows, where a win rate carries a standard error near
 *  eleven points, and quarter Kelly clears the operator's per-trade budget for any edge past six
 *  points. Left uncapped this resolves to full size for a band whose true edge is zero roughly two
 *  times in five. Capped, a false reading can only undersize, and the pipeline keeps its one
 *  direction: every adjustment lowers. */
export function resolveSizingScale(input: SizingScaleInput): SizingScale {
  const { bucket } = input
  const edgeRisk = realizedEdgeRisk(bucket)

  if (edgeRisk === undefined || bucket === undefined) {
    return { source: 'policy', scale: CONVICTION_SIZING_SCALE[input.conviction] }
  }

  const kellyRisk = KELLY_FRACTION * edgeRisk
  const realized = Math.max(kellyRisk / input.profile.riskPerTradePctNav, SCALE_FLOOR)
  const scale = Math.min(CONVICTION_SIZING_SCALE[input.conviction], realized)

  return { source: 'realized', scale, resolvedCount: bucket.resolvedCount }
}

/** Kelly for an uneven payoff: the fraction of NAV to hold is `p / L - q / W`, and the fraction
 *  lost when the typical loss lands is that times `L`, which is `p - q * L / W`. A band that has
 *  never lost risks its whole win rate; a band that has never won has no edge to size. */
function realizedEdgeRisk(bucket: CalibrationBucket | undefined): number | undefined {
  if (bucket?.winRate === undefined) {
    return undefined
  }

  if (bucket.meanWinPct === undefined) {
    return 0
  }

  if (bucket.meanLossPct === undefined) {
    return bucket.winRate
  }

  return bucket.winRate - ((1 - bucket.winRate) * Math.abs(bucket.meanLossPct)) / bucket.meanWinPct
}

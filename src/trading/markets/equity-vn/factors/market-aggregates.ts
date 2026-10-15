import type { CrossSection, NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import { latestNameSession, sessionBar } from '@/trading/markets/equity-vn/factors/factors'
import { TREND_SESSIONS } from '@/trading/markets/equity-vn/policy'
import { foreignFlowRatio } from '@/trading/markets/equity-vn/tape/flows'
import { trendDistance } from '@/trading/markets/timeseries'

/** The names a market-wide reading is a fact about, the same population breadth counts: shares that
 *  traded the population's newest session. A fund restates the index it tracks, and a name that
 *  last printed weeks ago describes a tape that has moved on. */
export function sessionShares(cross: CrossSection): readonly NameEvidence[] {
  const session = latestNameSession(cross.names)

  return session === undefined
    ? []
    : cross.names.filter(
        (name) => name.record.kind === 'equity' && sessionBar(name, session) !== undefined
      )
}

/** The market-wide foreign-flow deviation: the mean of the per-name ratios that could be computed
 *  at all. Averaging ratios rather than summing values keeps one mega-cap's block trade from
 *  standing in for the market, and a name whose ratio is absent is left out rather than counted as
 *  a flat zero. Absent when nothing could be aligned — which abstains, and abstaining reduces
 *  evidence coverage instead of reading as calm. */
export function marketForeignFlowRatio(cross: CrossSection): number | undefined {
  const ratios = sessionShares(cross)
    .map((name) => foreignFlowRatio(name.flows, name.bars))
    .filter((ratio): ratio is number => ratio !== undefined)

  return ratios.length === 0
    ? undefined
    : ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
}

/** The share of the population trading above its own medium-term average. Absent when nothing has
 *  enough history — which abstains, rather than reading as a healthy tape. */
export function marketParticipationAboveTrend(cross: CrossSection): number | undefined {
  const measured = sessionShares(cross)
    .map((name) => trendDistance(name.closes, TREND_SESSIONS))
    .filter((distance): distance is number => distance !== undefined)

  return measured.length === 0
    ? undefined
    : measured.filter((distance) => distance > 0).length / measured.length
}

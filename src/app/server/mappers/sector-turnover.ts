import type { OverviewSectorTurnoverWire } from '@/app/server/wire/overview'
import type { MarketDataOverview } from '@/trading/api'

/** The block's sectors as the page draws them: the figures only, since the page names the slug and
 *  places the ratio beside the sessions it was measured over. */
export function toSectorTurnoverWire(
  overview: MarketDataOverview
): readonly OverviewSectorTurnoverWire[] | undefined {
  return overview.sectorTurnover?.map((entry) => ({
    sector: entry.sector,
    turnover: entry.turnover,
    sharePct: entry.sharePct,
    ...(entry.turnoverRatio === undefined || entry.turnoverReference === undefined
      ? {}
      : { turnoverRatio: entry.turnoverRatio, sessions: entry.turnoverReference.sessions }),
  }))
}

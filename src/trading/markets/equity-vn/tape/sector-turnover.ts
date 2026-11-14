import type { TradingDay } from '@/trading/kernel/instrument'
import type { SectorTurnover } from '@/trading/kernel/market/market-overview'
import type { MarketDayTotals } from '@/trading/markets/equity-vn/factors/name-evidence'
import {
  VN_OVERVIEW_LEADERS,
  VN_TURNOVER_REFERENCE_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { toSessionMean, toTurnoverRatio } from '@/trading/markets/equity-vn/tape/session-totals'

/** The sectors that moved the most money on `session`, each against the market's total that day.
 *  Without a market total there is nothing to take a share of, so no sector is named. */
export function toSectorTurnover(
  totals: MarketDayTotals,
  session: TradingDay
): readonly SectorTurnover[] {
  const market = totals.turnover.get(session)

  if (market === undefined || market <= 0) {
    return []
  }

  return [...totals.sectorTurnover.entries()]
    .flatMap(([sector, byDay]) => {
      const entry = toSector(sector, byDay, { session, market })

      return entry === undefined ? [] : [entry]
    })
    .sort((left, right) => right.turnover - left.turnover)
    .slice(0, VN_OVERVIEW_LEADERS)
}

/** Absent for a sector none of whose names traded the session: no reading is not a measured zero. */
function toSector(
  sector: string,
  byDay: ReadonlyMap<TradingDay, number>,
  total: { readonly session: TradingDay; readonly market: number }
): SectorTurnover | undefined {
  const { session, market } = total
  const turnover = byDay.get(session)

  if (turnover === undefined) {
    return undefined
  }

  const turnoverReference = toSessionMean(byDay, session, VN_TURNOVER_REFERENCE_SESSIONS)
  const turnoverRatio = toTurnoverRatio(turnover, turnoverReference)

  return {
    sector,
    turnover,
    sharePct: turnover / market,
    ...(turnoverRatio === undefined ? {} : { turnoverRatio }),
    ...(turnoverReference === undefined ? {} : { turnoverReference }),
  }
}

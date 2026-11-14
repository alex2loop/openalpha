import type { TradingDay } from '@/trading/kernel/instrument'
import type { FlowSnapshot } from '@/trading/kernel/market/market-data'
import type {
  FlowSize,
  MarketFlowBalance,
  MarketFlowDay,
  SessionMean,
} from '@/trading/kernel/market/market-overview'
import {
  FLOW_DEVIATION_SESSIONS,
  FLOW_PERSISTENCE_MINIMUM_SESSIONS,
  VN_FLOW_BALANCE_SESSIONS,
  VN_FLOW_HEAVY_MULTIPLE,
  VN_FLOW_MEAN_SESSIONS,
  VN_FLOW_QUIET_MULTIPLE,
  VN_FLOW_STREAK_MINIMUM_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import { toSessionMean } from '@/trading/markets/equity-vn/tape/session-totals'

/** Who bought and who sold, anchored on the newest session the proprietary desks have figures for:
 *  they publish after the foreign desk, and a reading that paired today's foreign net with a desk
 *  that has not landed would hand the whole difference to individuals. Without any proprietary
 *  figure there is nothing to balance, so the block does not show. */
export function toFlowBalance(
  flows: ReadonlyMap<TradingDay, FlowSnapshot>,
  session: TradingDay
): MarketFlowBalance | undefined {
  const days = toFlowDays(flows, session)
  const anchor = days.findLast((day) => day.proprietaryNet !== undefined)
  const proprietaryNet = anchor?.proprietaryNet

  if (anchor === undefined || proprietaryNet === undefined) {
    return undefined
  }

  const institutionsNet = anchor.foreignNet + proprietaryNet
  const foreignMean = toLegMean(days, anchor.at, (day) => day.foreignNet)
  const proprietaryMean = toLegMean(days, anchor.at, (day) => day.proprietaryNet)
  const normal = toNormalGap(flows, anchor.at)
  const foreignStreak = toForeignStreak(days)

  return {
    session: anchor.at,
    foreignNet: anchor.foreignNet,
    proprietaryNet,
    othersNet: -institutionsNet,
    ...(foreignMean === undefined ? {} : { foreignMean }),
    ...(proprietaryMean === undefined ? {} : { proprietaryMean }),
    ...(normal === undefined
      ? {}
      : { normal, size: toFlowSize(Math.abs(institutionsNet) / normal.value) }),
    ...(foreignStreak === undefined ? {} : { foreignStreak }),
    days,
  }
}

function toFlowDays(
  flows: ReadonlyMap<TradingDay, FlowSnapshot>,
  session: TradingDay
): readonly MarketFlowDay[] {
  return [...flows.values()]
    .filter((flow) => flow.at <= session)
    .sort((left, right) => left.at.localeCompare(right.at))
    .slice(-VN_FLOW_BALANCE_SESSIONS)
    .map((flow) => ({
      at: flow.at,
      foreignNet: flow.foreignNetValue,
      ...(flow.proprietaryNetValue === undefined
        ? {}
        : { proprietaryNet: flow.proprietaryNetValue }),
    }))
}

/** A signed mean, so unlike a turnover mean it may be negative. Only days that state the leg are in
 *  it: a desk not yet published is absent from the average, not a zero pulling it. */
function toLegMean(
  days: readonly MarketFlowDay[],
  anchor: TradingDay,
  leg: (day: MarketFlowDay) => number | undefined
): SessionMean | undefined {
  const values = days
    .filter((day) => day.at <= anchor)
    .flatMap((day) => {
      const value = leg(day)

      return value === undefined ? [] : [value]
    })
    .slice(-VN_FLOW_MEAN_SESSIONS)

  return values.length === 0
    ? undefined
    : {
        sessions: values.length,
        value: values.reduce((sum, value) => sum + value, 0) / values.length,
      }
}

/** The usual gap the two institutional groups leave for everyone else, over the sessions before the
 *  anchor that carry both legs. Read from the whole map, not the charted days, so a lagging desk
 *  does not cost the window a session. */
function toNormalGap(
  flows: ReadonlyMap<TradingDay, FlowSnapshot>,
  anchor: TradingDay
): SessionMean | undefined {
  const gaps = new Map<TradingDay, number>()

  for (const flow of flows.values()) {
    if (flow.proprietaryNetValue !== undefined) {
      gaps.set(flow.at, Math.abs(flow.foreignNetValue + flow.proprietaryNetValue))
    }
  }

  const normal = toSessionMean(gaps, anchor, FLOW_DEVIATION_SESSIONS)

  return normal === undefined || normal.sessions < FLOW_PERSISTENCE_MINIMUM_SESSIONS
    ? undefined
    : normal
}

function toFlowSize(multiple: number): FlowSize {
  if (multiple < VN_FLOW_QUIET_MULTIPLE) {
    return 'quiet'
  }

  return multiple >= VN_FLOW_HEAVY_MULTIPLE ? 'heavy' : 'usual'
}

/** Counted back from the newest charted day over days on its side; a net of exactly zero is on
 *  neither, so it ends the run. */
function toForeignStreak(days: readonly MarketFlowDay[]): MarketFlowBalance['foreignStreak'] {
  const newest = days.at(-1)

  if (newest === undefined || newest.foreignNet === 0) {
    return undefined
  }

  const sign = Math.sign(newest.foreignNet)
  const sessions = days.length - 1 - days.findLastIndex((day) => Math.sign(day.foreignNet) !== sign)

  return sessions < VN_FLOW_STREAK_MINIMUM_SESSIONS
    ? undefined
    : { side: sign > 0 ? 'buy' : 'sell', sessions }
}

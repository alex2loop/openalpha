import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketLeader, MarketLeaders } from '@/trading/kernel/market/market-overview'
import type { NameEvidence } from '@/trading/markets/equity-vn/factors/factors'
import {
  VN_OVERVIEW_LEADERS,
  VN_PROPRIETARY_LOOKBACK_SESSIONS,
} from '@/trading/markets/equity-vn/policy'
import {
  type SessionValue,
  sessionChangePct,
  sessionForeignNet,
  sessionProprietaryNet,
  sessionTotal,
  sessionTurnover,
} from '@/trading/markets/equity-vn/tape/session-totals'
import { OVERVIEW_LEADER_SESSIONS } from '@/trading/markets/overview'

/** Who the session's money went to. Both flow directions, because a market that sold on balance
 *  still had names being accumulated, and that is the half a net figure hides. A list nobody
 *  qualified for is absent rather than empty — an empty list would read as "these are the leaders".
 */
export function toLeaders(
  names: readonly NameEvidence[],
  session: TradingDay
): MarketLeaders | undefined {
  const turnoverTotal = sessionTotal(names, session, sessionTurnover) ?? 0
  const foreign = netLeaders(names, session, sessionForeignNet)
  const proprietary = proprietaryLeaders(names, session)
  const mostTraded = rankNames(names, session, sessionTurnover).slice(0, VN_OVERVIEW_LEADERS)

  if (
    foreign.buys.length === 0 &&
    foreign.sells.length === 0 &&
    proprietary.buys.length === 0 &&
    proprietary.sells.length === 0 &&
    mostTraded.length === 0
  ) {
    return undefined
  }

  return {
    window: 'session',
    sessions: OVERVIEW_LEADER_SESSIONS,
    ...(foreign.buys.length === 0 ? {} : { foreignBuys: foreign.buys }),
    ...(foreign.sells.length === 0 ? {} : { foreignSells: foreign.sells }),
    ...(proprietary.buys.length === 0 ? {} : { proprietaryBuys: proprietary.buys }),
    ...(proprietary.sells.length === 0 ? {} : { proprietarySells: proprietary.sells }),
    ...(proprietary.day === session ? {} : { proprietaryDay: proprietary.day }),
    ...(mostTraded.length === 0 ? {} : { mostTraded: withShare(mostTraded, turnoverTotal) }),
  }
}

/** The biggest net buyers and net sellers of one flow, each with its share of its own side's gross. */
function netLeaders(
  names: readonly NameEvidence[],
  session: TradingDay,
  of: SessionValue
): { readonly buys: readonly MarketLeader[]; readonly sells: readonly MarketLeader[] } {
  const ranked = rankNames(names, session, of)
  const buyers = ranked.filter((entry) => entry.value > 0)
  const sellers = ranked.filter((entry) => entry.value < 0)

  return {
    buys: withShare(buyers.slice(0, VN_OVERVIEW_LEADERS), grossValue(buyers)),
    sells: withShare(sellers.slice(-VN_OVERVIEW_LEADERS).reverse(), grossValue(sellers)),
  }
}

/** The proprietary desk's leaders from the newest session that has any, looking back a few flow
 *  sessions because the desk publishes after the foreign one. The day travels with the lists so an
 *  older desk is never read as the session's; empty lists carry the session itself. */
function proprietaryLeaders(
  names: readonly NameEvidence[],
  session: TradingDay
): ReturnType<typeof netLeaders> & { readonly day: TradingDay } {
  const days = new Set<TradingDay>()

  for (const name of names) {
    for (const flow of name.flows) {
      if (flow.at <= session) {
        days.add(flow.at)
      }
    }
  }

  const recent = [...days].sort().reverse().slice(0, VN_PROPRIETARY_LOOKBACK_SESSIONS)

  for (const day of recent) {
    const leaders = netLeaders(names, day, sessionProprietaryNet)

    if (leaders.buys.length > 0 || leaders.sells.length > 0) {
      return { ...leaders, day }
    }
  }

  return { buys: [], sells: [], day: session }
}

/** A direction's gross flow: a share of the net would pass 100% on a day the other side nearly
 *  cancelled it. */
function grossValue(leaders: readonly MarketLeader[]): number {
  return leaders.reduce((sum, leader) => sum + Math.abs(leader.value), 0)
}

/** Each leader's value as a share of the session's total for its list — how concentrated the top is.
 *  A name that did not trade reports no value, so it never appears; a zero total yields no share. */
function withShare(leaders: readonly MarketLeader[], total: number): MarketLeader[] {
  if (total === 0) {
    return leaders.map((leader) => ({ ...leader }))
  }

  return leaders.map((leader) => ({ ...leader, sharePct: Math.abs(leader.value) / total }))
}

/** Descending, so a caller takes buys from the head and sells from the tail of one sorted pass. */
function rankNames(
  names: readonly NameEvidence[],
  session: TradingDay,
  of: SessionValue
): readonly MarketLeader[] {
  return names
    .flatMap((name) => {
      const value = of(name, session)

      if (value === undefined) {
        return []
      }

      const changePct = sessionChangePct(name, session)

      return [
        {
          instrument: name.record.instrument,
          value,
          ...(changePct === undefined ? {} : { changePct }),
        },
      ]
    })
    .sort((left, right) => right.value - left.value)
}

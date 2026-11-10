import type { TradingDay } from '@/trading/kernel/instrument'
import type { BarRecord, FlowSnapshot } from '@/trading/kernel/market/market-data'
import type { MarketTurnoverReference } from '@/trading/kernel/market/market-overview'
import type {
  MarketDayTotals,
  NameEvidence,
} from '@/trading/markets/equity-vn/factors/name-evidence'
import { sessionBar } from '@/trading/markets/equity-vn/factors/factors'
import { VN_TURNOVER_REFERENCE_SESSIONS } from '@/trading/markets/equity-vn/policy'
import { sessionChange } from '@/trading/markets/timeseries'
import { barTurnover } from '@/trading/markets/turnover'

const PERCENT_PER_UNIT = 100

/** One name's value for one session, so the folds below take what to sum as an argument rather than
 *  repeating the same absence rules per measure. */
export type SessionValue = (name: NameEvidence, asOf: TradingDay) => number | undefined

/** Only where the name settled this session: a flow row can name a day its own tape never reached,
 *  and the change off its closes there is an earlier day's move dated to today. */
export function sessionChangePct(name: NameEvidence, session: TradingDay): number | undefined {
  if (sessionBar(name, session) === undefined) {
    return undefined
  }

  const change = sessionChange(name.closes)

  return change === undefined ? undefined : change * PERCENT_PER_UNIT
}

/** The session's traded value across the whole market. Exported because the brief's tape reports
 *  the same total the overview does, and two derivations of one number eventually disagree. */
export function sessionTurnoverTotal(
  names: readonly NameEvidence[],
  session: TradingDay
): number | undefined {
  return sessionTotal(names, session, sessionTurnover)
}

/** Absent rather than zero when no name reported the session: a total of nothing would read as a
 *  market that traded nothing. */
export function sessionTotal(
  names: readonly NameEvidence[],
  session: TradingDay,
  of: SessionValue
): number | undefined {
  const values = names.flatMap((name) => {
    const value = of(name, session)

    return value === undefined ? [] : [value]
  })

  return values.length === 0 ? undefined : values.reduce((sum, value) => sum + value, 0)
}

/** Days with no reported turnover are absent from the mean, not zeros in it, so `sessions` reports
 *  what was averaged rather than what was asked for. */
export function toTurnoverReference(
  totals: MarketDayTotals,
  session: TradingDay
): MarketTurnoverReference | undefined {
  const days = [...totals.turnover.keys()]
    .filter((day) => day < session)
    .sort()
    .slice(-VN_TURNOVER_REFERENCE_SESSIONS)

  if (days.length === 0) {
    return undefined
  }

  const value = days.reduce((sum, day) => sum + (totals.turnover.get(day) ?? 0), 0) / days.length

  return value <= 0 ? undefined : { sessions: days.length, value }
}

/** Adds one name's bars to the market's per-day traded value. A bar stating no usable figure
 *  adds nothing, so its day is absent rather than zero. */
export function addTurnoverTo(byDay: Map<TradingDay, number>, bars: readonly BarRecord[]): void {
  for (const bar of bars) {
    const value = barTurnover(bar)

    if (value !== undefined) {
      byDay.set(bar.candle.at, (byDay.get(bar.candle.at) ?? 0) + value)
    }
  }
}

/** How busy today was against a normal session. Shared with the brief's tape, which reports the
 *  same number. */
export function toTurnoverRatio(
  turnover: number | undefined,
  reference: MarketTurnoverReference | undefined
): number | undefined {
  return turnover === undefined || reference === undefined ? undefined : turnover / reference.value
}

/** A name counts only when its newest record is the session being reported: an older one belongs to
 *  a name that did not trade, and adding it would date the total. */
export function sessionTurnover(name: NameEvidence, asOf: TradingDay): number | undefined {
  const last = name.bars[name.bars.length - 1]

  return last === undefined || last.candle.at !== asOf ? undefined : barTurnover(last)
}

export function sessionForeignNet(name: NameEvidence, asOf: TradingDay): number | undefined {
  return sessionFlow(name, asOf)?.foreignNetValue
}

export function sessionProprietaryNet(name: NameEvidence, asOf: TradingDay): number | undefined {
  return sessionFlow(name, asOf)?.proprietaryNetValue
}

function sessionFlow(name: NameEvidence, asOf: TradingDay): FlowSnapshot | undefined {
  return name.flows.find((flow) => flow.at === asOf)
}

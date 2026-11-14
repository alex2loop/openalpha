import type { OverviewFlowBalanceWire } from '@/app/server/wire/overview'
import type { Locale } from '@/core/types/locale'
import type { MarketDataOverview } from '@/trading/api'
import { renderFlowBalanceReading } from '@/trading/api'

type FlowBalance = NonNullable<MarketDataOverview['flowBalance']>
type SessionMean = NonNullable<FlowBalance['normal']>

/** The block's flow balance as the page draws it, with the CLI's own sentences as `reading`. */
export function toFlowBalanceWire(
  overview: MarketDataOverview,
  locale: Locale
): OverviewFlowBalanceWire | undefined {
  const { flowBalance } = overview

  if (flowBalance === undefined) {
    return undefined
  }

  const { foreignMean, proprietaryMean, normal, foreignStreak } = flowBalance
  const view = { balance: flowBalance, asOf: overview.asOf, currency: overview.currency }

  return {
    session: flowBalance.session,
    foreignNet: flowBalance.foreignNet,
    proprietaryNet: flowBalance.proprietaryNet,
    othersNet: flowBalance.othersNet,
    ...(foreignMean === undefined ? {} : { foreignMean: toSessionMeanWire(foreignMean) }),
    ...(proprietaryMean === undefined
      ? {}
      : { proprietaryMean: toSessionMeanWire(proprietaryMean) }),
    ...(normal === undefined ? {} : { normal: toSessionMeanWire(normal) }),
    ...(foreignStreak === undefined
      ? {}
      : { foreignStreak: { side: foreignStreak.side, sessions: foreignStreak.sessions } }),
    days: flowBalance.days.map((day) => ({
      at: day.at,
      foreignNet: day.foreignNet,
      proprietaryNet: day.proprietaryNet ?? null,
    })),
    reading: renderFlowBalanceReading(locale, view),
  }
}

function toSessionMeanWire(mean: SessionMean): { sessions: number; value: number } {
  return { sessions: mean.sessions, value: mean.value }
}

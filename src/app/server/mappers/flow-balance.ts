import type { OverviewFlowBalanceWire } from '@/app/server/wire/overview'
import type { Locale } from '@/core/types/locale'
import type { MarketDataOverview } from '@/trading/api'
import { renderFlowBalanceReading } from '@/trading/api'

/** The block's flow balance as the page draws it, with the CLI's own sentences as `reading`. */
export function toFlowBalanceWire(
  overview: MarketDataOverview,
  locale: Locale
): OverviewFlowBalanceWire | undefined {
  const { flowBalance } = overview

  if (flowBalance === undefined) {
    return undefined
  }

  const { foreignMean, proprietaryMean } = flowBalance
  const view = { balance: flowBalance, asOf: overview.asOf, currency: overview.currency }

  return {
    session: flowBalance.session,
    foreignNet: flowBalance.foreignNet,
    proprietaryNet: flowBalance.proprietaryNet,
    othersNet: flowBalance.othersNet,
    ...(foreignMean === undefined ? {} : { foreignMean }),
    ...(proprietaryMean === undefined ? {} : { proprietaryMean }),
    days: flowBalance.days.map((day) => ({
      at: day.at,
      foreignNet: day.foreignNet,
      proprietaryNet: day.proprietaryNet ?? null,
    })),
    reading: renderFlowBalanceReading(locale, view),
  }
}

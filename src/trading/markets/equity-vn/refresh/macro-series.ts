import type { TradingDay } from '@/trading/kernel/instrument'
import type { MarketDeps } from '@/trading/markets/deps'
import type { MarketDataRefreshRequest, TradingCalendar } from '@/trading/markets/types'
import { refreshFxSeries } from '@/trading/markets/equity-vn/refresh/fx-series'
import { refreshPolicyRates } from '@/trading/markets/equity-vn/refresh/policy-rates'

interface MacroSeriesRefresh {
  readonly deps: MarketDeps
  readonly calendar: TradingCalendar
  readonly asOf: TradingDay
  readonly request: MarketDataRefreshRequest
}

/** Every stored series the VN macro read depends on, written before it is read. */
export async function refreshMacroSeries(input: MacroSeriesRefresh): Promise<void> {
  const { deps, calendar, asOf, request } = input
  const shared = { deps, asOf, forced: request.forced, now: request.now, signal: request.signal }

  await refreshFxSeries({ ...shared, calendar })
  await refreshPolicyRates(shared)
}

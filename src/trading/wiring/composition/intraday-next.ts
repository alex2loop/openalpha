import type { IntradaySettingsStore } from '@/trading/features/market-data/store/intraday-settings'
import type { TradingConfig } from '@/trading/kernel/config'
import type { MarketRegistry } from '@/trading/markets/types'
import {
  nextIntradayFireAt,
  resolveIntradayPlan,
} from '@/trading/features/market-data/intraday/schedule'

/** Whether the intraday report is on, and when it next fires; `nextAt` is `null` while it is off
 *  or no time is configured. */
export interface IntradayNext {
  readonly enabled: boolean
  readonly nextAt: number | null
}

interface IntradayNextDeps {
  readonly markets: MarketRegistry
  readonly config: TradingConfig
  readonly settings: IntradaySettingsStore
}

export function toIntradayNext(deps: IntradayNextDeps): {
  nextIntraday(now: number, signal: AbortSignal): Promise<IntradayNext>
} {
  // Resolved once, as the loop does: boot has already rejected a region no market covers.
  const plan = resolveIntradayPlan(deps, deps.config.defaultRegion)

  return {
    nextIntraday: async (now, signal) => {
      const enabled = await deps.settings.isEnabled(signal)

      return { enabled, nextAt: enabled ? nextIntradayFireAt(plan, now) : null }
    },
  }
}

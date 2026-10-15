import type { TradingConfig } from '@/trading/kernel/config'
import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { resolveLocalTimeAt } from '@/trading/markets/calendar'

/** How far ahead the search walks before giving up. A calendar whose next trading day is further
 *  out than this is malformed, and walking forever would hang the loop instead of naming it. */
const MAXIMUM_LOOKAHEAD_DAYS = 8

export interface IntradayPlan {
  readonly market: Market
  readonly sendTimes: readonly string[]
}

interface IntradayPlanDeps {
  readonly markets: MarketRegistry
  readonly config: TradingConfig
}

export function resolveIntradayPlan(deps: IntradayPlanDeps, region: Region): IntradayPlan {
  const market = deps.markets.regionOwner(region)

  if (market === null) {
    throw new ValidationError(`no registered market covers region ${region}`)
  }

  return { market, sendTimes: deps.config.intraday.sendTimes }
}

/** The earliest configured instant strictly after `now`, searching forward over trading days.
 *  Strictly after is what stops a restart from repeating the fire it just made: the fire that has
 *  passed is never the answer. `null` means nothing is scheduled - an empty `send_times`, which is
 *  how the send is turned off. */
export function nextIntradayFireAt(plan: IntradayPlan, now: number): number | null {
  if (plan.sendTimes.length === 0) {
    return null
  }

  const calendar = plan.market.manifest.calendar
  let day = calendar.dayAt(now)

  for (let step = 0; step < MAXIMUM_LOOKAHEAD_DAYS; step += 1) {
    const at = calendar.isTradingDay(day) ? earliestAfter(plan, day, now) : undefined

    if (at !== undefined) {
      return at
    }

    day = calendar.addTradingDays(day, 1)
  }

  return null
}

// `sendTimes` is not assumed sorted: the operator writes the list, and sorting the resolved instants
// is cheaper than validating order at config time.
function earliestAfter(plan: IntradayPlan, day: TradingDay, now: number): number | undefined {
  const timezone = plan.market.manifest.calendar.timezone
  const candidates = plan.sendTimes
    .map((time) => resolveLocalTimeAt(day, time, timezone))
    .filter((at) => at > now)
    .sort((left, right) => left - right)

  return candidates[0]
}

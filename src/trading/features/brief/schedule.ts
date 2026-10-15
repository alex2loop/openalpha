import type { BriefDelivery } from '@/trading/features/brief/types'
import type { TradingConfig } from '@/trading/kernel/config'
import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { Market, MarketRegistry } from '@/trading/markets/types'
import { ValidationError } from '@/core/errors'
import { resolveLocalTimeAt, shiftCalendarDay } from '@/trading/markets/calendar'

/** A pre-open brief must land before the market opens, so every send time is read in the market's
 *  own timezone. `[locale] timezone` is where the *operator* is: an operator in London asking for
 *  08:15 would get 15:15 ICT, past the close, and the pre-open check would reject every claim. */

/** The market that owns a region's calendar plus the resolved send time. All brief calendar
 *  arithmetic is the service's; the store only compares `next_due_at <= now`. */
export interface BriefSchedulePlan {
  readonly market: Market
  readonly sendTime: string
}

interface ScheduledDelivery {
  readonly day: TradingDay
  readonly dueAt: number
}

export interface SchedulePlanDeps {
  readonly markets: MarketRegistry
  readonly config: TradingConfig
}

/** Precedence: the row's own time, then `[trading.briefs] send_time`. A row that stored NULL keeps
 *  following config, so editing config later still moves the brief. */
export function resolvePlan(
  deps: SchedulePlanDeps,
  region: Region,
  sendTime?: string
): BriefSchedulePlan {
  const market = deps.markets.regionOwner(region)

  if (market === null) {
    throw new ValidationError(`no registered market covers region ${region}`)
  }

  return { market, sendTime: sendTime ?? deps.config.briefs.sendTime }
}

/** The day after `after`. Every calendar day is a send day: crypto trades the weekend, and the
 *  markets that do not each state the session their own block reports. */
export function nextScheduled(plan: BriefSchedulePlan, after: TradingDay): ScheduledDelivery {
  return scheduledOn(plan, shiftCalendarDay(after, 1))
}

/** The delivery a given day carries, whether or not its send time has passed. */
export function scheduledOn(plan: BriefSchedulePlan, day: TradingDay): ScheduledDelivery {
  return { day, dueAt: dueAtFor(plan, day) }
}

/** Today when its send time has not passed, tomorrow otherwise - so subscribing after this
 *  morning's send waits for tomorrow rather than firing at once. */
export function initialScheduled(plan: BriefSchedulePlan, now: number): ScheduledDelivery {
  const today = plan.market.manifest.calendar.dayAt(now)
  const scheduled = scheduledOn(plan, today)

  return scheduled.dueAt > now ? scheduled : nextScheduled(plan, today)
}

/** Whether the send time lands before the calendar owner's next open. Checked when the operator
 *  subscribes: a brief goes out on days that market is shut, and the only time worth refusing is
 *  one that would never be pre-open on a day it does trade. Delivery asks `isPreOpen` again. */
export function isValidSendTime(plan: BriefSchedulePlan, now: number): boolean {
  const { calendar } = plan.market.manifest

  if (calendar.continuous) {
    return true
  }

  const today = calendar.dayAt(now)
  const session = calendar.isTradingDay(today) ? today : calendar.addTradingDays(today, 1)

  return calendar.sessionState(dueAtFor(plan, session)) === 'pre-open'
}

/** Both writes of the one delivery row start here. A brief being built or sent holds a lease the
 *  write would wipe, which sends it twice; one already delivered today must not be re-armed for
 *  today, which would send a second. */
export function scheduleGuardOf(
  current: BriefDelivery | null,
  plan: BriefSchedulePlan,
  now: number
): 'delivering' | { readonly skipToday: boolean } {
  if (current?.state === 'delivering') {
    return 'delivering'
  }

  return { skipToday: current?.lastDeliveredDay === plan.market.manifest.calendar.dayAt(now) }
}

function dueAtFor(plan: BriefSchedulePlan, day: TradingDay): number {
  return resolveLocalTimeAt(day, plan.sendTime, plan.market.manifest.calendar.timezone)
}

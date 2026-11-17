import type { ActivityResponse } from '@/app/server/wire/activity'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'

/** The operator's day now, in `[locale] timezone`: the day a read of today's runs is keyed by and
 *  is compared against. Absent until the session names the zone. */
export function operatorToday(): string | undefined {
  const timeZone = state.value?.timeZone

  return timeZone === undefined ? undefined : buildDayKey(Date.now(), timeZone)
}

/** Runs ended today, on the operator's calendar. */
export function loadTodayActivity(abort: AbortSignal): Promise<ActivityResponse> {
  const day = operatorToday()

  return getJson(ROUTES.activity, { query: day === undefined ? {} : { day }, signal: abort })
}

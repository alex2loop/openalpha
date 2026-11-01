import type { ActivityResponse } from '@/app/server/wire/activity'
import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'

/** The runs that ended today, on the daemon's calendar. */
export function loadTodayActivity(abort: AbortSignal): Promise<ActivityResponse> {
  const timeZone = state.value?.timeZone
  const query = timeZone === undefined ? {} : { day: buildDayKey(Date.now(), timeZone) }

  return getJson(ROUTES.activity, { query, signal: abort })
}

import { computed, type ReadonlySignal, signal } from '@preact/signals'

import type { CostReport } from '@/app/server/wire/system'
import { ApiFailure, getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { createSingleFlight } from '@/web/api/single-flight'
import { onWireEvent } from '@/web/state/events'
import { state } from '@/web/state/session'
import { buildDayKey } from '@/web/text/time'

const COST_POLL_MS = 60_000
const MONTH_START_DAY = '01'
// `YYYY-MM-` of a day key.
const MONTH_PREFIX_LENGTH = 8
const REFETCH_KINDS = ['run_finished', 'budget_warning', 'budget_exhausted'] as const

/** The month so far against the caps, with today's spend picked out of it. */
interface CostView {
  /** Absent when the report left today out, which it should not. */
  readonly todayUsd?: number
  readonly monthUsd: number
  readonly caps: CostReport['caps']
  readonly day: string
  /** Epoch ms the report was read. */
  readonly readAt: number
}

const view = signal<CostView | undefined>(undefined)
const failure = signal<ApiFailure | undefined>(undefined)
// The day a budget event fired: it holds the chip in Caution for the rest of that day.
const budgetAlertDay = signal<string | undefined>(undefined)

/** Absent until the first read. */
export const cost: ReadonlySignal<CostView | undefined> = view
export const costFailure: ReadonlySignal<ApiFailure | undefined> = failure
/** A budget event fired today, or today's or the month's spend reached the warn share of its cap. */
export const isCostCaution = computed(() => {
  const current = view.value

  if (current === undefined) {
    return budgetAlertDay.value !== undefined
  }

  return (
    budgetAlertDay.value === current.day ||
    isPastWarn(current.todayUsd, current.caps.dailyUsd, current.caps.warnRatio) ||
    isPastWarn(current.monthUsd, current.caps.monthlyUsd, current.caps.warnRatio)
  )
})

/** Reads the month's cost now, every `COST_POLL_MS`, and once more after a run ends or a budget
 *  event fires. The returned stop is idempotent. */
export function startCost(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadCost, lifetime.signal)
  const offs = REFETCH_KINDS.map((kind) =>
    onWireEvent(kind, (event) => {
      if (event.kind !== 'run_finished') {
        budgetAlertDay.value = resolveToday(Date.now())
      }

      // `refetch` never rejects: `loadCost` records its own failure.
      refetch().catch(() => undefined)
    })
  )
  const stopPoll = startPoll(() => refetch(), COST_POLL_MS)

  return () => {
    lifetime.abort()
    stopPoll()

    for (const off of offs) {
      off()
    }
  }
}

async function loadCost(abortSignal: AbortSignal): Promise<void> {
  const readAt = Date.now()
  const day = resolveToday(readAt)

  if (day === undefined) {
    return
  }

  try {
    const report = await getJson(ROUTES.cost, {
      query: { from: `${day.slice(0, MONTH_PREFIX_LENGTH)}${MONTH_START_DAY}`, to: day },
      signal: abortSignal,
    })

    view.value = toView(report, readAt)
    failure.value = undefined
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the stop's own abort.
    if (error instanceof ApiFailure) {
      failure.value = error
    }
  }
}

// The daemon counts its days in its own zone, so the page asks in that zone too.
function resolveToday(atMs: number): string | undefined {
  const timeZone = state.value?.timeZone

  return timeZone === undefined ? undefined : buildDayKey(atMs, timeZone)
}

function toView(report: CostReport, readAt: number): CostView {
  const today = report.days.find((entry) => entry.day === report.toDay)

  return {
    ...(today === undefined ? {} : { todayUsd: today.costUsd }),
    monthUsd: report.totalUsd,
    caps: report.caps,
    day: report.toDay,
    readAt,
  }
}

// A cap of 0 is no cap.
function isPastWarn(spentUsd: number | undefined, capUsd: number, warnRatio: number): boolean {
  return spentUsd !== undefined && capUsd > 0 && spentUsd >= capUsd * warnRatio
}

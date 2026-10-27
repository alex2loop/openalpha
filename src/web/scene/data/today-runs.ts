import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActivityResponse } from '@/app/server/wire/activity'
import { createSingleFlight } from '@/web/api/single-flight'
import { loadTodayActivity } from '@/web/state/activity'
import { onWireEvent } from '@/web/state/events'

// The daemon writes a finished run's row a moment after it announces the finish.
const SETTLE_MS = 1_500

const runs = signal<ActivityResponse | undefined>(undefined)

/** The runs that ended today, read as the scene mounts and again after each run that ends; absent
 *  until read, and after a failed first read, so the desks then show only what happens while the
 *  page is open. */
export const todayRuns: ReadonlySignal<ActivityResponse | undefined> = runs

/** Reads today's runs now and after every run that ends; the returned stop drops the read in
 *  flight and forgets the answer. */
export function startTodayRuns(): () => void {
  const lifetime = new AbortController()
  const refetch = createSingleFlight(loadRuns, lifetime.signal)
  let settle: ReturnType<typeof setTimeout> | undefined
  const off = onWireEvent('run_finished', () => {
    clearTimeout(settle)
    settle = setTimeout(() => {
      // `refetch` never rejects: `loadRuns` keeps the last good answer on a failure.
      refetch().catch(() => undefined)
    }, SETTLE_MS)
  })

  refetch().catch(() => undefined)

  return () => {
    lifetime.abort()
    clearTimeout(settle)
    off()
    runs.value = undefined
  }
}

async function loadRuns(abort: AbortSignal): Promise<void> {
  try {
    const answer = await loadTodayActivity(abort)

    if (!abort.aborted) {
      runs.value = answer
    }
  } catch {
    // The last good answer stays; before the first read the boards name none.
  }
}

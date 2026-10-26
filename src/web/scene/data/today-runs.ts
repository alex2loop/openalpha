import { type ReadonlySignal, signal } from '@preact/signals'

import type { ActivityResponse } from '@/app/server/wire/activity'
import { loadTodayActivity } from '@/web/state/activity'

const runs = signal<ActivityResponse | undefined>(undefined)

/** The runs that ended today, read once as the scene mounts; absent until read, and after a failed
 *  read, so the desks then show only what happens while the page is open. */
export const todayRuns: ReadonlySignal<ActivityResponse | undefined> = runs

/** Reads today's runs once; the returned stop drops the read in flight and forgets the answer. */
export function startTodayRuns(): () => void {
  const read = new AbortController()

  // A failed read leaves the desks to what happens while the page is open.
  loadTodayActivity(read.signal).then(
    (answer) => {
      if (!read.signal.aborted) {
        runs.value = answer
      }
    },
    () => undefined
  )

  return () => {
    read.abort()
    runs.value = undefined
  }
}

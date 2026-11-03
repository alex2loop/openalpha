import { computed, signal } from '@preact/signals'

import { isAnalysisOnly } from '@/web/state/edition'
import { onCommandFinished } from '@/web/state/events'
import { backgroundTasks } from '@/web/state/live'
import { state } from '@/web/state/session'
import { formatWhen } from '@/web/text/time'
import { tr } from '@/web/text/tr'

// The worker reports both under these names (`app/browser/upkeep.ts`).
const REFRESH_TASK = 'trading.refresh'
const HISTORY_TASK = 'browser.history'
const REFRESH_COMMAND = 'refresh'
const COMPLETED = 'completed'

// The page's own sight of the data's age: the upkeep's last refresh from the live feed, and the
// visitor's own `/refresh`, which that feed does not report.
const refreshedByHand = signal<number | undefined>(undefined)
const isOffline = signal(false)
const isHistoryLoading = computed(
  () => backgroundTasks.value?.some((task) => task.name === HISTORY_TASK && task.working) === true
)
const dataAt = computed(() => {
  const upkeep = backgroundTasks.value?.find((task) => task.name === REFRESH_TASK)?.lastRunAt

  return Math.max(upkeep ?? 0, refreshedByHand.value ?? 0) || undefined
})

/** Follows what the line below reads that the feed does not carry: a `/refresh` that ended here and
 *  whether the device has a network. The returned stop releases both. */
export function startDataStatus(): () => void {
  const offRefresh = onCommandFinished(REFRESH_COMMAND, (outcome) => {
    if (outcome === COMPLETED) {
      refreshedByHand.value = Date.now()
    }
  })
  const setOffline = (): void => {
    isOffline.value = true
  }
  const setOnline = (): void => {
    isOffline.value = false
  }

  isOffline.value = !navigator.onLine
  addEventListener('offline', setOffline)
  addEventListener('online', setOnline)

  return () => {
    offRefresh()
    removeEventListener('offline', setOffline)
    removeEventListener('online', setOnline)
  }
}

/** Where market data is shown on the web: how old it is, that the price history is still loading,
 *  or that the device is offline and the figures are the ones stored last time. Nothing on the
 *  daemon, which is always connected and keeps its own tasks in view. */
export function DataStatus() {
  const timeZone = state.value?.timeZone

  if (!isAnalysisOnly.value) {
    return null
  }

  return (
    <>
      {isOffline.value && <p class="meta">{tr('ui.office.edition.history.offline')}</p>}
      {isHistoryLoading.value && <p class="meta">{tr('ui.office.edition.history.loading')}</p>}
      {dataAt.value !== undefined && timeZone !== undefined && (
        <p class="meta">
          {tr('ui.office.edition.history.dataAt', { time: formatWhen(dataAt.value, timeZone) })}
        </p>
      )}
    </>
  )
}

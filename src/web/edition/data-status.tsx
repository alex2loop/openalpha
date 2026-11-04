import { computed, signal } from '@preact/signals'

import { isAnalysisOnly } from '@/web/state/edition'
import { backgroundTasks } from '@/web/state/live'
import { tr } from '@/web/text/tr'

// The worker reports the price-history load under this name (`app/browser/upkeep.ts`).
const HISTORY_TASK = 'browser.history'

const isOffline = signal(false)
const isHistoryLoading = computed(
  () => backgroundTasks.value?.some((task) => task.name === HISTORY_TASK && task.working) === true
)

/** Follows whether the device has a network. The returned stop releases the listeners. */
export function startDataStatus(): () => void {
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
    removeEventListener('offline', setOffline)
    removeEventListener('online', setOnline)
  }
}

/** Where market data is shown on the web: that the price history is still loading, or that the
 *  device is offline and the figures are the ones stored last time. Each block states its own data
 *  date and read time, as on the dashboard. */
export function DataStatus() {
  if (!isAnalysisOnly.value) {
    return null
  }

  return (
    <>
      {isOffline.value && <p class="meta">{tr('ui.office.edition.history.offline')}</p>}
      {isHistoryLoading.value && <p class="meta">{tr('ui.office.edition.history.loading')}</p>}
    </>
  )
}

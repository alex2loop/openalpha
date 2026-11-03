import { readKeepsData } from '@/web/edition/persistence'
import { tr } from '@/web/text/tr'
import { useLoad } from '@/web/ui/kit/use-load'

/** Whether the browser agreed to keep the visitor's data when the device runs short of room. The
 *  line is advice, so a browser that cannot say says nothing. */
export function StorageStatus() {
  const reading = useLoad(readKeepsData).value

  if (reading.status !== 'ready' || reading.value === undefined) {
    return null
  }

  return (
    <p class="meta">
      {tr(
        reading.value
          ? 'ui.office.edition.storage.persisted'
          : 'ui.office.edition.storage.notPersisted'
      )}
    </p>
  )
}

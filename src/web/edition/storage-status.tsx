import { getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { tr } from '@/web/text/tr'
import { useLoad } from '@/web/ui/kit/use-load'

/** Whether the browser agreed to keep the visitor's data when the device runs short of room. The
 *  line is advice, so a read that fails, or a browser that was never asked, says nothing. */
export function StorageStatus() {
  const reading = useLoad((signal) => getJson(ROUTES.storage, { signal })).value

  if (reading.status !== 'ready' || reading.value.persisted === null) {
    return null
  }

  return (
    <p class="meta">
      {tr(
        reading.value.persisted
          ? 'ui.office.edition.storage.persisted'
          : 'ui.office.edition.storage.notPersisted'
      )}
    </p>
  )
}

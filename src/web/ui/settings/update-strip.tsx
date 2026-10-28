import { dismissUpdate, isUpdateShown, update } from '@/web/state/update'
import { tr } from '@/web/text/tr'
import { Button } from '@/web/ui/kit/button'
import { openUpdateDialog } from '@/web/ui/settings/update-dialog'

/** Đã có bản mới, at the top of Cài đặt until Để sau puts that version off in this browser.
 *  `reopen` brings Cài đặt back when the dialog closes. */
export function UpdateStrip({ reopen }: { readonly reopen: () => void }) {
  const answer = update.value

  if (!isUpdateShown.value || answer === undefined || answer.latest === null) {
    return null
  }

  const latest = answer.latest

  return (
    <div class="update-strip setting-actions" role="status">
      <span>{tr('ui.office.update.available', { latest, current: answer.current })}</span>
      <Button size="small" onClick={() => openUpdateDialog({ onBack: reopen })}>
        {tr('ui.office.update.notes')}
      </Button>
      <Button size="small" onClick={() => dismissUpdate(latest)}>
        {tr('ui.office.settings.later')}
      </Button>
    </div>
  )
}

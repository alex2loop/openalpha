import { pluralKey } from '@/i18n'
import { pendingRestart } from '@/web/state/settings'
import { isUpdateNewer } from '@/web/state/update'
import { tr } from '@/web/text/tr'
import { GearIcon } from '@/web/ui/kit/icons'
import { openSettings } from '@/web/ui/settings/settings'

import './settings.css'

/** The gear that opens Cài đặt, with a badge while saved settings wait for a restart or a newer
 *  release is out. */
export function GearButton() {
  const count = pendingRestart.value.length
  const isBadged = count > 0 || isUpdateNewer.value
  const label = labelOf(count)

  return (
    <button
      type="button"
      class="icon-button gear-button"
      title={label}
      aria-label={label}
      aria-haspopup="dialog"
      onClick={() => openSettings()}
    >
      <GearIcon />
      {isBadged && <span class="gear-badge" aria-hidden="true" />}
    </button>
  )
}

// A restart waiting is named before a newer release.
function labelOf(count: number): string {
  if (count > 0) {
    return tr(pluralKey(count, 'ui.office.header.gearPendingOne', 'ui.office.header.gearPending'), {
      count,
    })
  }

  return isUpdateNewer.value ? tr('ui.office.update.dot') : tr('ui.office.settings.title')
}

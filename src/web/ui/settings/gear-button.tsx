import { pluralKey } from '@/i18n'
import { pendingRestart } from '@/web/state/settings'
import { tr } from '@/web/text/tr'
import { GearIcon } from '@/web/ui/kit/icons'
import { openSettings } from '@/web/ui/settings/settings'

import './settings.css'

/** The gear that opens Cài đặt, with a badge while saved settings wait for a restart. */
export function GearButton() {
  const count = pendingRestart.value.length
  const label =
    count === 0
      ? tr('ui.office.settings.title')
      : tr(pluralKey(count, 'ui.office.header.gearPendingOne', 'ui.office.header.gearPending'), {
          count,
        })

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
      {count > 0 && <span class="gear-badge" aria-hidden="true" />}
    </button>
  )
}

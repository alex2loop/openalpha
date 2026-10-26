import { useSignal } from '@preact/signals'

import { askNotifyPermission, canNotify } from '@/web/state/attention'
import { openChimeAudio, previewChime } from '@/web/state/chime'
import { chime, notify, setChime, setNotify } from '@/web/state/prefs'
import { tr } from '@/web/text/tr'
import { openKeysDialog } from '@/web/ui/keys/keys-dialog'
import { Button } from '@/web/ui/kit/button'
import { ActionRow } from '@/web/ui/settings/row'

/** Hiển thị's rows for how the page calls the operator, and where its shortcuts are listed. Each is
 *  kept in this browser and applies the moment it changes. */
export function AttentionRows() {
  return (
    <>
      <ChimeRow />
      {'Notification' in window && <NotifyRow />}
      <ActionRow title={tr('ui.office.keys.title')}>
        <Button size="small" onClick={openKeysDialog}>
          {tr('ui.office.header.keys')}
        </Button>
      </ActionRow>
    </>
  )
}

function ChimeRow() {
  const title = tr('ui.office.settings.chime')

  return (
    <ActionRow title={title} note={tr('ui.office.settings.chimeNote')}>
      <input
        type="checkbox"
        aria-label={title}
        checked={chime.value}
        onChange={(event) => {
          const isOn = event.currentTarget.checked

          // The click is the gesture a browser needs before it plays a sound.
          if (isOn) {
            openChimeAudio()
          }

          setChime(isOn)
        }}
      />
      <Button size="small" onClick={previewChime}>
        {tr('ui.office.settings.chimeTest')}
      </Button>
    </ActionRow>
  )
}

// The permission is asked only from this click; a refusal leaves it off and says where to allow it.
function NotifyRow() {
  const title = tr('ui.office.settings.notify')
  const isBlocked = useSignal(!canNotify())

  async function turn(isOn: boolean): Promise<void> {
    if (!isOn) {
      setNotify(false)
      return
    }

    const isGranted = await askNotifyPermission()

    setNotify(isGranted)
    isBlocked.value = !(isGranted || canNotify())
  }

  return (
    <ActionRow
      title={title}
      note={tr(
        isBlocked.value ? 'ui.office.settings.notifyBlocked' : 'ui.office.settings.notifyNote'
      )}
    >
      <input
        type="checkbox"
        aria-label={title}
        checked={notify.value && !isBlocked.value}
        disabled={isBlocked.value}
        onChange={(event) => {
          const box = event.currentTarget

          // A refused permission leaves the stored value as it was, so the box is set back by hand.
          turn(box.checked)
            .catch(() => undefined)
            .finally(() => {
              box.checked = notify.peek() && !isBlocked.peek()
            })
        }}
      />
    </ActionRow>
  )
}

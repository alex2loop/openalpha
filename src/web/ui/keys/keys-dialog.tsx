import { editionKey } from '@/web/state/edition'
import { tr } from '@/web/text/tr'
import { SHORTCUT_ROWS } from '@/web/ui/keys/keys'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'

import './keys.css'

/** The list of shortcuts, from the header's "?" button, the "?" key or Cài đặt › Hiển thị. `onBack`
 *  leads back to Cài đặt when it opened the list. */
export function openKeysDialog({ onBack }: { readonly onBack?: () => void } = {}): void {
  const handle = openModal({
    title: tr('ui.office.keys.title'),
    body: <KeyList />,
    footer: (
      <Button kind="commit" onClick={() => (onBack === undefined ? handle.close() : onBack())}>
        {tr('ui.office.common.close')}
      </Button>
    ),
    ...(onBack === undefined ? {} : { onDismiss: onBack }),
  })
}

function KeyList() {
  return (
    <>
      <dl class="key-list">
        {SHORTCUT_ROWS.map((row) => (
          <div key={row.does} class="key-row">
            <dt>
              {row.caps.map((cap) => (
                <kbd key={cap}>{cap}</kbd>
              ))}
            </dt>
            <dd>{tr(row.webDoes === undefined ? row.does : editionKey(row.does, row.webDoes))}</dd>
          </div>
        ))}
      </dl>
      <p class="meta">{tr('ui.office.keys.note')}</p>
    </>
  )
}

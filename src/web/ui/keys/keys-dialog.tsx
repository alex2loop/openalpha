import { tr } from '@/web/text/tr'
import { SHORTCUT_ROWS } from '@/web/ui/keys/keys'
import { Button } from '@/web/ui/kit/button'
import { openModal } from '@/web/ui/kit/modal'

import './keys.css'

/** The list of shortcuts, from the header's "?" button, the "?" key or Cài đặt › Hiển thị. */
export function openKeysDialog(): void {
  const handle = openModal({
    title: tr('ui.office.keys.title'),
    body: <KeyList />,
    footer: (
      <Button kind="commit" onClick={() => handle.close()}>
        {tr('ui.office.common.close')}
      </Button>
    ),
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
            <dd>{tr(row.does)}</dd>
          </div>
        ))}
      </dl>
      <p class="meta">{tr('ui.office.keys.note')}</p>
    </>
  )
}

import { breakpoint } from '@/web/state/breakpoints'
import { unread } from '@/web/state/chat'
import { type Pane, pane, showPane } from '@/web/state/pane'
import { tr } from '@/web/text/tr'

import './pane-bar.css'

const PANES: readonly {
  readonly id: Pane
  readonly key: 'ui.office.floor.office' | 'ui.office.pane.info' | 'ui.office.chat.title'
}[] = Object.freeze([
  { id: 'office', key: 'ui.office.floor.office' },
  { id: 'info', key: 'ui.office.pane.info' },
  { id: 'chat', key: 'ui.office.chat.title' },
])

/** Under the header below the narrow width: one pane at a time, the chat with its unread dot. */
export function PaneBar() {
  if (breakpoint.value === 'wide') {
    return null
  }

  const current = pane.value

  return (
    <div class="pane-bar">
      <fieldset class="seg">
        <legend class="sr">{tr('ui.office.pane.group')}</legend>
        {PANES.map(({ id, key }) => (
          <button
            key={id}
            type="button"
            class={id === current ? 'is-on' : ''}
            aria-pressed={id === current}
            onClick={() => showPane(id)}
          >
            {tr(key)}
            {id === 'chat' && unread.value && <span class="chat-unread" aria-hidden="true" />}
          </button>
        ))}
      </fieldset>
    </div>
  )
}

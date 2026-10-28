import { breakpoint } from '@/web/state/breakpoints'
import { isChatOpen, setChatOpen, viewedSession } from '@/web/state/chat'
import { startNewSession } from '@/web/state/chat-history'
import { isChatOnly } from '@/web/state/pane'
import { tr } from '@/web/text/tr'
import { MessageList } from '@/web/ui/chat/message-list'
import { SessionView } from '@/web/ui/chat/session-view'
import { openSessionsDialog } from '@/web/ui/chat/sessions-dialog'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { CloseIcon, HistoryIcon, PlusIcon } from '@/web/ui/kit/icons'

import './chat.css'

/** Docked right: hidden by default, when the office takes its width and the command bar's chat
 *  button (with the unread dot) is the one way back. Below the narrow width it fills its pane, and
 *  its X goes back to the pane before it. */
export function ChatPanel() {
  if (!isChatOpen.value) {
    return null
  }

  const viewed = viewedSession.value

  return (
    <aside class="chat-panel chrome-glass" aria-label={tr('ui.office.chat.title')}>
      <ChatHead />
      {viewed === undefined ? <MessageList /> : <SessionView session={viewed} />}
    </aside>
  )
}

function ChatHead() {
  const closeLabel =
    breakpoint.value === 'wide' ? tr('ui.office.chat.hide') : tr('ui.office.pane.chatBack')

  return (
    <div class="chat-head">
      <h2>{tr('ui.office.chat.title')}</h2>
      <Button
        kind="ghost"
        size="small"
        title={tr('ui.office.chat.oldSessions')}
        onClick={openSessionsDialog}
      >
        <HistoryIcon />
        <span class="chat-head-label">{tr('ui.office.chat.oldSessions')}</span>
      </Button>
      <Button
        kind="ghost"
        size="small"
        title={tr('ui.office.chat.newSession')}
        onClick={askNewSession}
      >
        <PlusIcon />
        <span class="chat-head-label">{tr('ui.office.chat.newSession')}</span>
      </Button>
      {!isChatOnly.value && (
        <button
          type="button"
          class="btn btn-ghost btn-small"
          title={closeLabel}
          aria-label={closeLabel}
          onClick={() => setChatOpen(false)}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

function askNewSession(): void {
  askConfirm({
    title: tr('ui.office.chat.newAsk'),
    lines: [tr('ui.office.chat.newBody')],
    confirmLabel: tr('ui.office.chat.newSession'),
    confirm: startNewSession,
  })
}

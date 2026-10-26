import { breakpoint } from '@/web/state/breakpoints'
import { isChatOpen, setChatOpen, unread, viewedSession } from '@/web/state/chat'
import { isChatOnly } from '@/web/state/pane'
import { tr } from '@/web/text/tr'
import { MessageList } from '@/web/ui/chat/message-list'
import { SessionView, startNewSession } from '@/web/ui/chat/session-view'
import { openSessionsDialog } from '@/web/ui/chat/sessions-dialog'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { ChatIcon, CloseIcon } from '@/web/ui/kit/icons'

import './chat.css'

/** Docked right: hidden by default, a rail with the unread dot while closed. Below the narrow width
 *  it fills its pane, and its X goes back to the pane before it. */
export function ChatPanel() {
  if (!isChatOpen.value) {
    return <ChatRail />
  }

  const viewed = viewedSession.value

  return (
    <aside class="chat-panel" aria-label={tr('ui.office.chat.title')}>
      <ChatHead />
      {viewed === undefined ? <MessageList /> : <SessionView session={viewed} />}
    </aside>
  )
}

function ChatRail() {
  return (
    <div class="chat-rail">
      <button
        type="button"
        class="icon-button"
        title={tr('ui.office.chat.toggle')}
        aria-label={tr('ui.office.chat.toggle')}
        onClick={() => setChatOpen(true)}
      >
        <ChatIcon />
        {unread.value && <span class="chat-unread" aria-hidden="true" />}
      </button>
    </div>
  )
}

function ChatHead() {
  const closeLabel =
    breakpoint.value === 'wide' ? tr('ui.office.chat.hide') : tr('ui.office.pane.chatBack')

  return (
    <div class="chat-head glass">
      <h2>{tr('ui.office.chat.title')}</h2>
      <Button size="small" onClick={openSessionsDialog}>
        {tr('ui.office.chat.oldSessions')}
      </Button>
      <Button size="small" onClick={askNewSession}>
        {tr('ui.office.chat.newSession')}
      </Button>
      {!isChatOnly.value && (
        <button
          type="button"
          class="icon-button"
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

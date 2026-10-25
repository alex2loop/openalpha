import { clearAgentChoice } from '@/web/state/agents'
import { isChatOpen, setChatOpen, startSession, unread } from '@/web/state/chat'
import { tr } from '@/web/text/tr'
import { MessageList } from '@/web/ui/chat/message-list'
import { SessionView, viewedSession } from '@/web/ui/chat/session-view'
import { openSessionsDialog } from '@/web/ui/chat/sessions-dialog'
import { Button } from '@/web/ui/kit/button'
import { askConfirm } from '@/web/ui/kit/confirm'
import { ChatIcon, CloseIcon } from '@/web/ui/kit/icons'

import './chat.css'

/** Docked right: hidden by default, a rail with the unread dot while closed. */
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
  return (
    <div class="chat-head glass">
      <h2>{tr('ui.office.chat.title')}</h2>
      <Button size="small" onClick={openSessionsDialog}>
        {tr('ui.office.chat.oldSessions')}
      </Button>
      <Button size="small" onClick={askNewSession}>
        {tr('ui.office.chat.newSession')}
      </Button>
      <button
        type="button"
        class="icon-button"
        title={tr('ui.office.chat.hide')}
        aria-label={tr('ui.office.chat.hide')}
        onClick={() => setChatOpen(false)}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

function askNewSession(): void {
  askConfirm({
    title: tr('ui.office.chat.newAsk'),
    lines: [tr('ui.office.chat.newBody')],
    confirmLabel: tr('ui.office.chat.newSession'),
    confirm: () => {
      viewedSession.value = undefined
      startSession()
      clearAgentChoice()
    },
  })
}

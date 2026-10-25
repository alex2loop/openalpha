import { isFocus } from '@/web/state/panel'
import { ChatPanel } from '@/web/ui/chat/chat-panel'
import { Panel } from '@/web/ui/panel/panel'

import './panes.css'

/** Where each part of the office mounts: the stage, the info panel and the chat docked right. */
export function Panes() {
  return (
    <main class={isFocus.value ? 'panes is-focus' : 'panes'}>
      <div class="stage" />
      <Panel />
      <ChatPanel />
    </main>
  )
}

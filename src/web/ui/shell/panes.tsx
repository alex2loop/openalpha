import { ChatPanel } from '@/web/ui/chat/chat-panel'

import './panes.css'

/** Where each part of the office mounts: the stage, and the chat docked right. */
export function Panes() {
  return (
    <main class="panes">
      <div class="stage" />
      <ChatPanel />
    </main>
  )
}

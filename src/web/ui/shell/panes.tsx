import { SceneCanvas } from '@/web/scene/canvas'
import { FloorRow } from '@/web/scene/overlay/toolbar'
import { breakpoint } from '@/web/state/breakpoints'
import { pane } from '@/web/state/pane'
import { isFocus } from '@/web/state/panel'
import { SceneTwin } from '@/web/ui/a11y/scene-twin'
import { ChatPanel } from '@/web/ui/chat/chat-panel'
import { Panel } from '@/web/ui/panel/panel'
import { Tape } from '@/web/ui/tape/tape'

import './panes.css'

/** Where each part of the office mounts: the stage (the floor row, the tape, then the scene), the
 *  info panel and the chat docked right.
 *  Below the narrow width the pane bar picks the one shown; focus mode is a wide-screen choice. */
export function Panes() {
  const isFocused = isFocus.value && breakpoint.value === 'wide'

  return (
    <main class={isFocused ? 'panes is-focus' : 'panes'} data-pane={pane.value}>
      <div class="stage">
        <FloorRow />
        <Tape />
        <SceneCanvas />
      </div>
      <SceneTwin />
      <Panel />
      <ChatPanel />
    </main>
  )
}

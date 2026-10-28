import { computed } from '@preact/signals'

import { SceneCanvas } from '@/web/scene/canvas'
import { StillBackdrop } from '@/web/scene/overlay/still-backdrop'
import { FloorRow } from '@/web/scene/overlay/toolbar'
import { breakpoint } from '@/web/state/breakpoints'
import { isInfoOnly, pane } from '@/web/state/pane'
import { SceneTwin } from '@/web/ui/a11y/scene-twin'
import { ChatPanel } from '@/web/ui/chat/chat-panel'
import { CommandBar } from '@/web/ui/command/command-bar'
import { Panel } from '@/web/ui/panel/panel'
import { Tape } from '@/web/ui/tape/tape'

import './panes.css'

/** True while the command bar floats as glass islands at the foot of the stage's cell: on a wide
 *  screen, and on a narrow screen's office pane. */
export const isCommandBarFloating = computed(
  () => breakpoint.value === 'wide' || pane.value === 'office'
)

/** Where each part of the office mounts: the stage (the scene, with the floor row and the tape
 *  floating over its top and the command bar over its foot), the info panel and the chat docked
 *  right. On a wide screen the panel floats over the stage, above the command bar; in Info only the
 *  stage and the scene twin are not mounted at all and the panel takes the page at a reading width
 *  over a still picture of the office, the command bar floating under it; on a narrow screen the
 *  information pane is a bottom sheet over the stage.
 *  Below the narrow width the pane bar picks the one shown; Info only is a wide-screen choice. */
export function Panes() {
  return (
    <main class={breakpoint.value === 'wide' ? 'panes is-overlay' : 'panes'} data-pane={pane.value}>
      {isInfoOnly.value ? <StillBackdrop /> : <Stage />}
      <Panel />
      {isCommandBarFloating.value && <CommandBar isFloating />}
      <ChatPanel />
    </main>
  )
}

function Stage() {
  return (
    <>
      <div class="stage">
        <SceneCanvas />
        <div class="stage-top">
          <FloorRow />
          <Tape />
        </div>
      </div>
      <SceneTwin />
    </>
  )
}

import { computed } from '@preact/signals'

import { SceneCanvas } from '@/web/scene/canvas'
import { FloorRow } from '@/web/scene/overlay/toolbar'
import { breakpoint } from '@/web/state/breakpoints'
import { isInfoOnly, pane } from '@/web/state/pane'
import { isFloating } from '@/web/state/panel'
import { SceneTwin } from '@/web/ui/a11y/scene-twin'
import { ChatPanel } from '@/web/ui/chat/chat-panel'
import { CommandBar } from '@/web/ui/command/command-bar'
import { Panel } from '@/web/ui/panel/panel'
import { Tape } from '@/web/ui/tape/tape'

import './panes.css'

/** True while the stage is on screen: the command bar then floats over the scene's foot. */
export const isStageShown = computed(() =>
  breakpoint.value === 'wide' ? !isInfoOnly.value : pane.value === 'office'
)

/** Where each part of the office mounts: the stage (the scene, with the floor row and the tape
 *  floating over its top and the command bar over its foot), the info panel and the chat docked
 *  right. On a wide screen the panel floats over the stage, above the command bar; in Info only the
 *  stage and the scene twin are not mounted at all and the panel fills the page; on a narrow screen
 *  the information pane is a bottom sheet over the stage.
 *  Below the narrow width the pane bar picks the one shown; Info only is a wide-screen choice. */
export function Panes() {
  return (
    <main class={isFloating.value ? 'panes is-overlay' : 'panes'} data-pane={pane.value}>
      {!isInfoOnly.value && <Stage />}
      <Panel />
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
        {isStageShown.value && <CommandBar isFloating />}
      </div>
      <SceneTwin />
    </>
  )
}

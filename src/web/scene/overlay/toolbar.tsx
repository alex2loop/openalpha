import type { FloorId, RoomId } from '@/web/scene/types'
import { roomTagOf } from '@/web/scene/overlay/room-tags'
import { ZoomStack } from '@/web/scene/overlay/zoom-stack'
import { canPanToward, leaveRoom, projection, setFloor, view } from '@/web/scene/view'
import { breakpoint } from '@/web/state/breakpoints'
import { ESCAPE_KEY_CAP, PREVIOUS_GLYPH } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

import './toolbar.css'

const FLOORS: readonly {
  readonly id: FloorId
  readonly key: 'ui.office.floor.office' | 'ui.office.common.yourAgents'
}[] = Object.freeze([
  { id: 'office', key: 'ui.office.floor.office' },
  { id: 'team', key: 'ui.office.common.yourAgents' },
])

/** The row over the office column, above the tape: the floor switch and where you are. */
export function FloorRow() {
  const shown = view.value

  return (
    <div class="scene-floorrow">
      <FloorSwitch floor={shown.floor} />
      <Crumb floor={shown.floor} room={shown.room} />
    </div>
  )
}

/** The scene's controls over the canvas: the map controls and the hint. Panning is a drag, or
 *  the arrow keys on the canvas. */
export function Toolbar() {
  const shown = view.value
  const isZoomed = shown.room !== undefined || shown.zoomSteps > 0
  const isWide = breakpoint.value === 'wide'

  // Read so the arrows follow the camera.
  projection.value

  return (
    <>
      <ZoomStack />
      {(isZoomed || (!isWide && isPannable())) && (
        <p class="scene-hint glass">
          {isWide ? tr('ui.office.floor.hint') : tr('ui.office.floor.hintNear')}
        </p>
      )}
    </>
  )
}

// A narrow pane may not hold the whole floor even at its fitted zoom; the rest pans.
function isPannable(): boolean {
  return canPanToward(-1) || canPanToward(1)
}

function FloorSwitch({ floor }: { readonly floor: FloorId }) {
  return (
    <fieldset class="scene-floors glass">
      {FLOORS.map(({ id, key }) => (
        <button
          key={id}
          type="button"
          class="scene-tool"
          aria-pressed={floor === id}
          onClick={() => setFloor(id)}
        >
          {tr(key)}
        </button>
      ))}
    </fieldset>
  )
}

function Crumb({ floor, room }: { readonly floor: FloorId; readonly room: RoomId | undefined }) {
  if (room === undefined) {
    return (
      <p class="scene-crumb meta">
        {floor === 'office' ? tr('ui.office.floor.crumbOffice') : tr('ui.office.floor.crumbTeam')}
      </p>
    )
  }

  return (
    <div class="scene-crumb">
      <button type="button" class="scene-tool glass" onClick={leaveRoom}>
        {PREVIOUS_GLYPH} {tr('ui.office.floor.leave')}
        <kbd>{ESCAPE_KEY_CAP}</kbd>
      </button>
      <b>{roomTagOf(room, undefined).name}</b>
    </div>
  )
}

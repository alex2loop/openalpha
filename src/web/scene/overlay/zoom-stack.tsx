import type { ComponentChildren } from 'preact'

import { litRooms, toggleAllLamps } from '@/web/scene/sim/lamps'
import { leaveRoom, maxZoomSteps, minZoomSteps, view, zoomBy } from '@/web/scene/view'
import { ROOM_IDS } from '@/web/scene/world/rooms'
import { sceneView } from '@/web/state/prefs'
import { RESET_VIEW_GLYPH, ZOOM_IN_GLYPH, ZOOM_OUT_GLYPH } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'
import { LampIcon } from '@/web/ui/kit/icons'

import './zoom-stack.css'

const PERCENT = 100

interface ZoomButtonProps {
  readonly label: string
  readonly kind?: string
  readonly isDisabled?: boolean
  readonly isPressed?: boolean
  readonly onClick: () => void
  readonly children: ComponentChildren
}

/** The map controls floating at the scene's bottom right, from the bottom: zoom out, zoom in, back
 *  to the whole floor and the master lamp switch; 3D adds a bar that shows the zoom. */
export function ZoomStack() {
  const { zoomSteps, room } = view.value
  const maxSteps = maxZoomSteps()
  const minSteps = minZoomSteps()
  const span = maxSteps - minSteps

  return (
    <div class="scene-zoomstack">
      <ZoomButton
        label={tr('ui.office.floor.zoomOut')}
        isDisabled={room === undefined && zoomSteps <= minSteps}
        onClick={() => zoomBy(-1)}
      >
        {ZOOM_OUT_GLYPH}
      </ZoomButton>
      <ZoomButton
        label={tr('ui.office.floor.zoomIn')}
        isDisabled={zoomSteps >= maxSteps}
        onClick={() => zoomBy(1)}
      >
        {ZOOM_IN_GLYPH}
      </ZoomButton>
      <ZoomButton label={tr('ui.office.floor.leave')} kind="scene-zoomreset" onClick={leaveRoom}>
        {RESET_VIEW_GLYPH}
      </ZoomButton>
      <ZoomButton
        label={tr('ui.office.lights.all')}
        kind="scene-lamps"
        isPressed={litRooms.value.size > 0}
        onClick={() => toggleAllLamps(ROOM_IDS)}
      >
        <LampIcon class="scene-bulb" />
      </ZoomButton>
      {sceneView.value === '3d' && (
        <span class="scene-zoombar glass" aria-hidden="true">
          <i style={{ bottom: `${span > 0 ? ((zoomSteps - minSteps) / span) * PERCENT : 0}%` }} />
        </span>
      )}
    </div>
  )
}

function ZoomButton({ label, kind, isDisabled, isPressed, onClick, children }: ZoomButtonProps) {
  return (
    <button
      type="button"
      class={['scene-zoombtn', 'glass', kind].filter(Boolean).join(' ')}
      aria-label={label}
      title={label}
      disabled={isDisabled}
      aria-pressed={isPressed}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

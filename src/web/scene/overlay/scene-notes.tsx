import { StaleVeil } from '@/web/scene/overlay/stale-veil'
import { ViewNote } from '@/web/scene/overlay/view-note'

import './scene-notes.css'

/** What the scene says about itself at its top-centre: that the picture is stale, and the 3D view's
 *  loading or fallback line. */
export function SceneNotes() {
  return (
    <div class="scene-notes">
      <StaleVeil />
      <ViewNote />
    </div>
  )
}

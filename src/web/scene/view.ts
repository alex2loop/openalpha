import { signal } from '@preact/signals'

import type { FloorId, RoomId } from '@/web/scene/types'

interface SceneView {
  readonly floor: FloorId
  readonly room?: RoomId
}

const INITIAL_FLOOR: FloorId = 'office'

/** The floor on screen, and the room zoomed into when one is. */
export const view = signal<SceneView>({ floor: INITIAL_FLOOR })

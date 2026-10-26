import type { Rect, Size } from '@/web/scene/types'
import { FRAME_RECT } from '@/web/scene/view'

/** Below the narrow width the floor never draws under one CSS pixel per world pixel; the rest pans. */
export const NARROW_MIN_SCALE = 1
// Leaves a sliver of the pane around the frame.
const FRAME_FILL = 0.98
// A room fills the pane with a tenth of itself to spare round its walls.
const ROOM_PAD = 1.1

/** CSS px per world px that fits the floor framing in `pane`, before any renderer's snapping. */
export function fitFloorScale(pane: Size): number {
  return Math.min(pane.w / FRAME_RECT.w, pane.h / FRAME_RECT.h) * FRAME_FILL
}

/** CSS px per world px that fits `room` and a tenth to spare in `pane`. */
export function fitRoomScale(room: Rect, pane: Size): number {
  return Math.min(pane.w / (room.w * ROOM_PAD), pane.h / (room.h * ROOM_PAD))
}

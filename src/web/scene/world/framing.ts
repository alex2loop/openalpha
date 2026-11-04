import type { Point, Rect, Size } from '@/web/scene/types'
import type { Breakpoint } from '@/web/state/breakpoints'
import { FLOOR_CENTER, FRAME_RECT } from '@/web/scene/view'
import { FRONTAGE_FACE_TOP } from '@/web/scene/world/frontage'

// Below the narrow width the floor never draws under one CSS pixel per world pixel; the rest pans.
const NARROW_MIN_SCALE = 1
// Leaves a sliver of the pane around the frame.
const FRAME_FILL = 0.98
// A room fills the pane with a tenth of itself to spare round its walls.
const ROOM_PAD = 1.1
// The top of the framing the bars floating over the pane may cover: the sky and the roof over the
// frontage's face, which they leave clear.
const FRAME_COVERABLE_TOP = FRONTAGE_FACE_TOP - FRAME_RECT.y
// What the fitted view keeps in the part of the pane the bars leave clear: the framing from the
// frontage's face down.
const CLEAR_FRAME: Rect = Object.freeze({
  x: FRAME_RECT.x,
  y: FRONTAGE_FACE_TOP,
  w: FRAME_RECT.w,
  h: FRAME_RECT.h - FRAME_COVERABLE_TOP,
})

/** The CSS px of `pane` the floating panel covers on its right and the bars on its top. */
export interface PaneCover {
  readonly right: number
  readonly top: number
}

/** CSS px per world px that fits the floor framing in `pane`, with the frontage's face and all
 *  below it clear of the `topCover` px at its top, before any renderer's snapping. */
function fitFloorScale(pane: Size, topCover: number): number {
  const wide = pane.w / FRAME_RECT.w
  const tall = Math.min(pane.h / FRAME_RECT.h, (pane.h - topCover) / CLEAR_FRAME.h)

  return Math.min(wide, tall) * FRAME_FILL
}

/** The fitted floor's CSS px per world px as both renderers draw it, never under
 *  `NARROW_MIN_SCALE` below the wide width. */
export function fittedFloorScale(pane: Size, band: Breakpoint, topCover: number): number {
  const raw = fitFloorScale(pane, topCover)

  return band === 'wide' ? raw : Math.max(NARROW_MIN_SCALE, raw)
}

/** The world point at the pane's centre that frames the floor at `scale` in the part of the pane
 *  the panel and the bars leave clear: centred across, and the frontage's face to the floor's
 *  south margin centred down. */
export function homeCenterOf(scale: number, cover: PaneCover): Point {
  return {
    x: FLOOR_CENTER.x + cover.right / 2 / scale,
    y: CLEAR_FRAME.y + CLEAR_FRAME.h / 2 - cover.top / 2 / scale,
  }
}

/** CSS px per world px that fits `room` and a tenth to spare in `pane`. */
export function fitRoomScale(room: Rect, pane: Size): number {
  return Math.min(pane.w / (room.w * ROOM_PAD), pane.h / (room.h * ROOM_PAD))
}

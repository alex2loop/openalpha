import type { Rect, Size } from '@/web/scene/types'
import type { Breakpoint } from '@/web/state/breakpoints'
import { FRAME_RECT } from '@/web/scene/view'

// Leaves a sliver of the pane around the frame.
const FRAME_FILL = 0.98
// A room fills the pane with a tenth of itself to spare round its walls.
const ROOM_PAD = 1.1
// From this density up, eighth steps are too fine to see uneven art pixels.
const FINE_DPR = 2
const FINE_STEPS = 8
// A phone never draws the floor under one CSS pixel per world pixel; the rest pans.
const PHONE_MIN_SCALE = 1
// The floor is painted at a whole zoom of at most this, then stretched to the true scale.
const MAX_STRETCH = 6

/** CSS px per world px, and the whole zoom the floor is painted at before it is stretched to it. */
export interface Fit {
  readonly scale: number
  readonly stretch: number
}

/** The framing rectangle fitted to the pane, snapped so art pixels stay even. */
export function fitFloor(viewport: Size, dpr: number, breakpoint: Breakpoint): Fit {
  const raw = Math.min(viewport.w / FRAME_RECT.w, viewport.h / FRAME_RECT.h) * FRAME_FILL
  const snapped = snapScale(raw, dpr)

  return toFit(breakpoint === 'phone' ? Math.max(PHONE_MIN_SCALE, snapped) : snapped, dpr)
}

/** A room with its walls and a tenth to spare, in whole steps below `FINE_DPR`, so two partitions
 *  of one wall never draw at different widths. */
export function fitRoom(room: Rect, viewport: Size, dpr: number): Fit {
  const raw = Math.min(viewport.w / (room.w * ROOM_PAD), viewport.h / (room.h * ROOM_PAD))

  return toFit(snapScale(raw, dpr), dpr)
}

/** `scale` snapped the same way, for a zoom step above the fitted floor. */
export function toSnappedFit(scale: number, dpr: number): Fit {
  return toFit(snapScale(scale, dpr), dpr)
}

// Whole device pixels per world pixel under `FINE_DPR`, eighth CSS steps from it; a pane too small
// for one whole step keeps the raw scale.
function snapScale(raw: number, dpr: number): number {
  if (dpr >= FINE_DPR) {
    const fine = Math.floor(raw * FINE_STEPS) / FINE_STEPS

    return fine > 0 ? fine : raw
  }

  const whole = Math.floor(raw * dpr)

  return whole >= 1 ? whole / dpr : raw
}

function toFit(scale: number, dpr: number): Fit {
  return { scale, stretch: Math.min(MAX_STRETCH, Math.max(1, Math.floor(scale * dpr))) }
}

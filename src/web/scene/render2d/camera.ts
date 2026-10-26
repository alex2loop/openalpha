import type { Rect, Size } from '@/web/scene/types'
import type { Breakpoint } from '@/web/state/breakpoints'
import { fitFloorScale, fitRoomScale, NARROW_MIN_SCALE } from '@/web/scene/world/framing'

// From this density up, eighth steps are too fine to see uneven art pixels.
const FINE_DPR = 2
const FINE_STEPS = 8
// The floor is painted at a whole zoom of at most this, then stretched to the true scale.
const MAX_STRETCH = 6

/** CSS px per world px, and the whole zoom the floor is painted at before it is stretched to it. */
export interface Fit {
  readonly scale: number
  readonly stretch: number
}

/** The framing rectangle fitted to the pane, snapped so art pixels stay even. */
export function fitFloor(viewport: Size, dpr: number, breakpoint: Breakpoint): Fit {
  const raw = fitFloorScale(viewport)
  const snapped = snapScale(raw, dpr)

  return toFit(breakpoint === 'wide' ? snapped : Math.max(NARROW_MIN_SCALE, snapped), dpr)
}

/** A room with its walls and a tenth to spare, in whole steps below `FINE_DPR`, so two partitions
 *  of one wall never draw at different widths. */
export function fitRoom(room: Rect, viewport: Size, dpr: number): Fit {
  const raw = fitRoomScale(room, viewport)

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

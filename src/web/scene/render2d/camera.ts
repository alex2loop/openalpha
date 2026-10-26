import type { Rect, Size } from '@/web/scene/types'
import type { Breakpoint } from '@/web/state/breakpoints'
import { fitFloorScale, fitRoomScale, NARROW_MIN_SCALE } from '@/web/scene/world/framing'

// From this density up, quarter steps are too fine to see uneven art pixels.
const FINE_DPR = 2
const FINE_STEPS = 4
// The floor is painted at a whole zoom of at most this, then stretched to the true scale.
const MAX_STRETCH = 6
// A scale a float hair under a whole device step still paints at that step.
const WHOLE_SLACK = 1e-6

/** CSS px per world px, and the whole zoom the floor is painted at before it is stretched to it. */
export interface Fit {
  readonly scale: number
  readonly stretch: number
}

/** The framing rectangle fitted to the pane at its true scale, as the mockup fills it: the floor
 *  is painted at the whole zoom under it and stretched pixel for pixel, so a fraction neither
 *  blurs nor seams. */
export function fitFloor(viewport: Size, dpr: number, breakpoint: Breakpoint): Fit {
  const raw = fitFloorScale(viewport)

  return fitAt(breakpoint === 'wide' ? raw : Math.max(NARROW_MIN_SCALE, raw), dpr)
}

/** A room with its walls and a tenth to spare, in whole device steps below `FINE_DPR` so two
 *  partitions of one wall never draw at different widths, and never under the fitted floor. */
export function fitRoom(room: Rect, viewport: Size, spec: { dpr: number; floor: Fit }): Fit {
  const raw = fitRoomScale(room, viewport)

  return fitAt(Math.max(spec.floor.scale, snapScale(raw, spec.dpr)), spec.dpr)
}

// Whole device pixels per world pixel under `FINE_DPR`, quarter device steps from it; a pane too
// small for one whole step keeps the raw scale.
function snapScale(raw: number, dpr: number): number {
  const steps = dpr >= FINE_DPR ? FINE_STEPS : 1
  const snapped = Math.floor(raw * dpr * steps) / steps

  return snapped >= 1 ? snapped / dpr : raw
}

/** `scale` as it is, a zoom step's or a fit's, with the whole zoom it is painted at. */
export function fitAt(scale: number, dpr: number): Fit {
  const whole = Math.floor(scale * dpr + WHOLE_SLACK)

  return { scale, stretch: Math.min(MAX_STRETCH, Math.max(1, whole)) }
}

import { MS_PER_SECOND } from '@/web/text/time-units'

/** The 2D renderer's frame cost. */
export const FRAME_2D_BUDGET_MS = 1.4
/** Renders a second while only small motion (breathing, blinking, typing, pets, steam) is on. */
export const SMALL_MOTION_RENDERS_PER_S = 30
/** The 3D renderer's draw calls on the busiest floor. */
export const DRAW_CALLS_MAX = 230
/** One street sim step at the busiest page minute. */
export const STREET_STEP_BUDGET_MS = 0.2
/** One repaint of the street's static canvas, at most once a page minute. */
export const STREET_PAINT_BUDGET_MS = 8
/** Frames a second of the 2D floor's ambient effects (dust, ribbons, the LED strip, the rack, the
 *  approval light, bubbles) while nothing else moves; one clock for all of them. */
const AMBIENT_FX_FPS = 8
/** Milliseconds between two beats of that clock. */
export const AMBIENT_FX_GAP_MS = MS_PER_SECOND / AMBIENT_FX_FPS

/** The ambient clock at `nowMs`: the instant of the beat it falls in. */
export function ambientMsOf(nowMs: number): number {
  return Math.floor(nowMs / AMBIENT_FX_GAP_MS) * AMBIENT_FX_GAP_MS
}

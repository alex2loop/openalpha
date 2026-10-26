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

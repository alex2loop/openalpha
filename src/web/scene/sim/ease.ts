// The mockup's easing: a share of the way to the target each frame, 1 - e^(-dt / tau), the frame
// gap capped, a value this near its target landing on it.
const MAX_DT_MS = 100
const SETTLED = 0.003
/** The gap that lands every value on its target: the first frame, and reduced motion. */
export const AT_ONCE = Number.POSITIVE_INFINITY

/** The gap since the last frame, capped; `AT_ONCE` on the first frame and under reduced motion. */
export function frameGapOf(at: {
  readonly nowMs: number
  readonly lastMs: number | undefined
  readonly isReduced: boolean
}): number {
  return at.isReduced || at.lastMs === undefined
    ? AT_ONCE
    : Math.min(MAX_DT_MS, at.nowMs - at.lastMs)
}

/** `from` a frame of `dtMs` closer to `to`, with time constant `tauMs`. */
export function easeToward(from: number, to: number, at: { dtMs: number; tauMs: number }): number {
  return at.dtMs === AT_ONCE || Math.abs(to - from) < SETTLED
    ? to
    : from + (to - from) * (1 - Math.exp(-at.dtMs / at.tauMs))
}

/** One value easing to whatever target `view` is given each frame; the first view lands on it. */
interface Fade {
  view(to: number, dtMs: number): number
  /** Whether the last view was still on its way to its target. */
  isMoving(): boolean
}

export function createFade(tauMs: number): Fade {
  let shown: number | undefined
  let isMoving = false

  return {
    view(to, dtMs) {
      shown = easeToward(shown ?? to, to, { dtMs, tauMs })
      isMoving = shown !== to

      return shown
    },
    isMoving: () => isMoving,
  }
}

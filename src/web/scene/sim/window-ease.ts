import type { SunView, WindowLight } from '@/web/scene/sky-types'
import { BLIND_CUT, GLASS_SIDES, windowLightOf } from '@/web/scene/clock/window-light'

// The mockup's easing: a share of the way to the target each frame, 1 - e^(-dt / tau), the frame
// gap capped, a value this near its target landing on it.
const BLIND_TAU_MS = 900
const PATCH_TAU_MS = 600
const MAX_DT_MS = 100
const SETTLED = 0.003

/** The window light the renderers draw, eased on the sky's clock: what `windowLightOf` asks for, with the blinds easing
 *  to their closure and the patches to their strength, at once under reduced motion. `view`
 *  fills one object in place. */
interface WindowEase {
  view(at: {
    readonly nowMs: number
    readonly isReduced: boolean
    readonly sun: SunView
    readonly cloud: number
    readonly rain: number
  }): WindowLight
  /** Whether the last view was still on its way to its target. */
  isEasing(): boolean
}

export function createWindowEase(): WindowEase {
  const shown = {
    blind: { w: 0, e: 0 },
    patch: { w: 0, e: 0, n: 0, s: 0 },
    depth: { w: 0, e: 0, n: 0, s: 0 },
  }
  let lastMs: number | undefined
  let isMoving = false

  return {
    view({ nowMs, isReduced, sun, cloud, rain }) {
      const target = windowLightOf(sun, { cloud, rain })
      const dtMs =
        isReduced || lastMs === undefined
          ? Number.POSITIVE_INFINITY
          : Math.min(MAX_DT_MS, nowMs - lastMs)
      let isSettling = false
      const ease = (from: number, to: number, tauMs: number): number => {
        const next =
          dtMs === Number.POSITIVE_INFINITY || Math.abs(to - from) < SETTLED
            ? to
            : from + (to - from) * (1 - Math.exp(-dtMs / tauMs))

        isSettling ||= next !== to

        return next
      }

      lastMs = nowMs
      shown.blind.w = ease(shown.blind.w, target.blind.w, BLIND_TAU_MS)
      shown.blind.e = ease(shown.blind.e, target.blind.e, BLIND_TAU_MS)

      // The blinds cut a patch as far as they are drawn now, not as far as they are headed.
      for (const side of GLASS_SIDES) {
        const cut = side === 'w' || side === 'e' ? 1 - BLIND_CUT * shown.blind[side] : 1

        shown.patch[side] = ease(shown.patch[side], target.patch[side] * cut, PATCH_TAU_MS)
      }

      shown.depth = target.depth
      isMoving = isSettling

      return shown
    },
    isEasing: () => isMoving,
  }
}

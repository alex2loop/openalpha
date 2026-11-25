import type { RunDeadline } from '@/core/tool'
import { unrefTimer } from '@/core/utils/time'

/** A one-shot timeout whose clock stops while a caller holds it paused. */
export interface PausableTimer extends RunDeadline {
  dispose(): void
}

/** `fire` runs once, after `ms` of unpaused time. Pauses are counted, not a flag: overlapping
 *  pauses would otherwise let the inner resume restart the clock while an outer caller still holds
 *  it stopped. Once it fired or was disposed, nothing arms it again: a caller settling late must
 *  not start a fresh timer against a torn-down owner. */
export function createPausableTimer(ms: number, fire: () => void): PausableTimer {
  let remainingMs = ms
  let startedAt = performance.now()
  let pauses = 0
  let done = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const onFire = (): void => {
    done = true
    fire()
  }
  const arm = (): void => {
    timer = unrefTimer(setTimeout(onFire, remainingMs))
  }

  arm()

  return {
    pause(): void {
      pauses += 1

      if (pauses === 1 && !done) {
        clearTimeout(timer)
        remainingMs -= performance.now() - startedAt
      }
    },

    resume(): void {
      if (pauses === 0) {
        return
      }

      pauses -= 1

      if (pauses === 0 && !done) {
        startedAt = performance.now()
        arm()
      }
    },

    dispose(): void {
      done = true
      clearTimeout(timer)
    },
  }
}

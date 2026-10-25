import { type ReadonlySignal, signal } from '@preact/signals'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const reducedMotionQuery = matchMedia(REDUCED_MOTION_QUERY)
const systemReducedMotion = signal(reducedMotionQuery.matches)
const lifetime = new AbortController()

reducedMotionQuery.addEventListener(
  'change',
  (event) => {
    systemReducedMotion.value = event.matches
  },
  { signal: lifetime.signal }
)

/** The browser asks for less motion: bumps, pings and flashes stop. */
export const reducedMotion: ReadonlySignal<boolean> = systemReducedMotion

/** Releases the media listener; idempotent. */
export function disposePrefs(): void {
  lifetime.abort()
}

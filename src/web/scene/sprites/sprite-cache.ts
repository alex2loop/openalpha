import { SPRITE_BUILD_SLICE_MS } from '@/web/scene/budgets'
import { zeroCanvas } from '@/web/scene/renderer'
import { MS_PER_SECOND } from '@/web/text/time-units'

/** A sprite not drawn for this long is dropped: the light, the zoom and the poses move on, and an
 *  old frame is rarely drawn again. */
const SPRITE_IDLE_MS = 60 * MS_PER_SECOND

// While a frame paints, sprites are built only until `until`; each one left out is counted.
const builds = { until: Number.POSITIVE_INFINITY, skips: 0 }
// Every cache's eviction, run once a frame so an idle sprite goes even while nothing new is built.
const sweeps: ((now: number) => void)[] = []

interface CacheSpec<T> {
  readonly max: number
  readonly canvasOf: (sprite: T) => HTMLCanvasElement
}

interface HeldSprite<T> {
  readonly sprite: T
  drawnAt: number
}

/** Painted sprites by key, least recently drawn first: past `max`, or idle past a minute, a sprite
 *  goes and its pixels are freed, so the cache holds what the scene draws now. */
interface SpriteCache<T> {
  /** The sprite under `key`, marked drawn now; absent when not held. */
  get(key: string): T | undefined
  /** The sprite under `key`, built with `build` when not held and the frame still has time to;
   *  absent when it has none. */
  obtain(key: string, build: () => T | undefined): T | undefined
  /** Zeroes and drops every sprite. */
  clear(): void
}

/** A frame's `paint` that builds missing sprites only for one slice; it answers true when the
 *  frame must be followed by another, because `paint` says so or a sprite was left out. */
export function withinBuildSlice<A extends unknown[]>(
  paint: (...args: A) => boolean
): (...args: A) => boolean {
  return (...args) => {
    const skipsBefore = builds.skips
    const now = performance.now()

    for (const sweep of sweeps) {
      sweep(now)
    }

    builds.until = now + SPRITE_BUILD_SLICE_MS

    try {
      return paint(...args) || builds.skips !== skipsBefore
    } finally {
      builds.until = Number.POSITIVE_INFINITY
    }
  }
}

/** Whether the frame painting now still has time to build something costly; a no is counted as a
 *  sprite left out, so another frame follows. */
export function hasBuildTime(): boolean {
  if (performance.now() <= builds.until) {
    return true
  }

  builds.skips++

  return false
}

/** How many sprites have been left out so far: a count that moved over a paint means it is not
 *  whole. */
export function spriteBuildSkips(): number {
  return builds.skips
}

export function createSpriteCache<T>(spec: CacheSpec<T>): SpriteCache<T> {
  const held = new Map<string, HeldSprite<T>>()
  const cache: SpriteCache<T> = {
    get(key) {
      const entry = held.get(key)

      if (entry === undefined) {
        return undefined
      }

      held.delete(key)
      held.set(key, entry)
      entry.drawnAt = performance.now()

      return entry.sprite
    },
    obtain(key, build) {
      const sprite = cache.get(key)

      if (sprite !== undefined) {
        return sprite
      }

      if (!hasBuildTime()) {
        return undefined
      }

      const built = build()

      if (built !== undefined) {
        store(held, spec, { key, sprite: built })
      }

      return built
    },
    clear() {
      for (const entry of held.values()) {
        zeroCanvas(spec.canvasOf(entry.sprite))
      }

      held.clear()
    },
  }

  sweeps.push((now) => evict(held, spec, now))

  return cache
}

// Held newest last.
function store<T>(
  held: Map<string, HeldSprite<T>>,
  spec: CacheSpec<T>,
  next: { readonly key: string; readonly sprite: T }
): void {
  const now = performance.now()

  held.set(next.key, { sprite: next.sprite, drawnAt: now })
  evict(held, spec, now)
}

// Past `max`, or idle too long, the least recently drawn go.
function evict<T>(held: Map<string, HeldSprite<T>>, spec: CacheSpec<T>, now: number): void {
  for (const [oldest, entry] of held) {
    if (held.size <= spec.max && now - entry.drawnAt < SPRITE_IDLE_MS) {
      break
    }

    zeroCanvas(spec.canvasOf(entry.sprite))
    held.delete(oldest)
  }
}

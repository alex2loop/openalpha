const FNV_OFFSET = 2_166_136_261
const FNV_PRIME = 16_777_619
const KEY_SEPARATOR = '|'
const MULBERRY_STEP = 0x6d_2b_79_f5
const UINT32_RANGE = 4_294_967_296
const LCG_MULTIPLIER = 1_664_525
const LCG_INCREMENT = 1_013_904_223

/** A short-lived stream of chance for one decision, keyed by what it decides. */
export interface Rng {
  /** In [0, 1). */
  next(): number
  /** A whole number in [lo, hi]. */
  int(lo: number, hi: number): number
  pick<T>(items: readonly [T, ...T[]]): T
}

/** FNV-1a over the joined parts: the same parts always give the same seed. */
export function seedOf(...parts: readonly string[]): number {
  const key = parts.join(KEY_SEPARATOR)
  let hash = FNV_OFFSET

  for (let i = 0; i < key.length; i++) {
    hash = Math.imul(hash ^ key.charCodeAt(i), FNV_PRIME)
  }

  return hash >>> 0
}

/** Mulberry32 from `seed`: the same seed always gives the same draws. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (state + MULBERRY_STEP) >>> 0

    let t = state

    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE
  }

  return toRng(next)
}

/** A linear congruential stream from `seed`: the draws the mockup's hand-drawn marks were laid out
 *  on, kept so those marks come out the same. */
export function createLcgRng(seed: number): Rng {
  let state = seed >>> 0

  const next = (): number => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0

    return state / UINT32_RANGE
  }

  return toRng(next)
}

function toRng(next: () => number): Rng {
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (items) => items[Math.floor(next() * items.length)] ?? items[0],
  }
}

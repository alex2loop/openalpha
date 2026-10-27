import { createLcgRng, seedOf } from '@/web/scene/world/rng'

/** When the pets and the fish move: each creature has its own bouts, the mockup's, and rests
 *  between them, so a floor where nobody walks can go fully still. */
export interface AnimalBouts {
  /** The creature `key` is inside a bout at `nowMs`. */
  isOn(key: string, nowMs: number): boolean
  /** The next instant a bout of `key` starts or ends. */
  nextAt(key: string, nowMs: number): number
}

/** One window of the shared sequence; every creature's bout sits inside it. */
interface BoutWindow {
  readonly index: number
  readonly startMs: number
  readonly endMs: number
}

const BOUTS_SEED = 20_261_025
const WINDOW_SALT = 7_919
const SPAN_SALT = 40_503
// The first window opens this long after the sequence is first asked; the rest between two
// windows and the length of one are drawn from their ranges.
const LEAD_MS = Object.freeze({ min: 9_000, max: 13_000 })
const WINDOW_MS = Object.freeze({ min: 10_000, max: 30_000 })
const REST_MS = Object.freeze({ min: 12_000, max: 60_000 })
// A creature starts up to this share of its window late and stops no earlier than `END_MIN` of
// it, so they do not move in lockstep.
const START_LAG = 0.25
const END_MIN = 0.6
const KEEP_WINDOWS = 8
const HASH_MULTIPLIER = 0x45_d9_f3_b
const HASH_SHIFT = 16

export function createAnimalBouts(): AnimalBouts {
  const windows: BoutWindow[] = []

  const nextWindow = (askedMs: number): BoutWindow => {
    const prev = windows.at(-1)
    const index = prev === undefined ? 0 : prev.index + 1
    const rng = createLcgRng(hash32(BOUTS_SEED + index * WINDOW_SALT))
    const startMs =
      prev === undefined
        ? askedMs + between(rng.next(), LEAD_MS)
        : prev.endMs + between(rng.next(), REST_MS)

    return { index, startMs, endMs: startMs + between(rng.next(), WINDOW_MS) }
  }

  const windowAt = (nowMs: number): BoutWindow => {
    while ((windows.at(-1)?.endMs ?? Number.NEGATIVE_INFINITY) <= nowMs) {
      windows.push(nextWindow(nowMs))
    }

    windows.splice(0, Math.max(0, windows.length - KEEP_WINDOWS))

    return windows.find((one) => one.endMs > nowMs) ?? windows[0] ?? nextWindow(nowMs)
  }

  return {
    isOn: (key, nowMs) => {
      const span = spanOf(key, windowAt(nowMs))

      return nowMs >= span.startMs && nowMs < span.endMs
    },
    nextAt: (key, nowMs) => {
      for (let one = windowAt(nowMs); ; one = windowAt(one.endMs)) {
        const span = spanOf(key, one)

        if (nowMs < span.startMs) {
          return span.startMs
        }

        if (nowMs < span.endMs) {
          return span.endMs
        }
      }
    },
  }
}

function spanOf(
  key: string,
  one: BoutWindow
): { readonly startMs: number; readonly endMs: number } {
  const rng = createLcgRng(hash32(seedOf(key) + one.index * SPAN_SALT))
  const length = one.endMs - one.startMs

  return {
    startMs: one.startMs + rng.next() * START_LAG * length,
    endMs: one.startMs + length * (END_MIN + (1 - END_MIN) * rng.next()),
  }
}

function between(draw: number, range: { readonly min: number; readonly max: number }): number {
  return range.min + draw * (range.max - range.min)
}

function hash32(value: number): number {
  let n = Math.imul(value ^ (value >>> HASH_SHIFT), HASH_MULTIPLIER)

  n = Math.imul(n ^ (n >>> HASH_SHIFT), HASH_MULTIPLIER)

  return (n ^ (n >>> HASH_SHIFT)) >>> 0
}

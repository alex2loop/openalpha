import { createLcgRng, seedOf } from '@/web/scene/world/rng'

/** When the floor's ambient motion runs: one seeded sequence of windows, the mockup's, that every
 *  consumer shares. Each keeps to its own stretch inside a window and rests outside it, so a floor
 *  where nobody walks can go fully still. */
interface AmbientWindows {
  /** `key` is inside its stretch of a window at `nowMs`. */
  isOn(key: string, nowMs: number): boolean
  /** The next instant a stretch of `key` starts or ends. */
  nextAt(key: string, nowMs: number): number
  /** The first instant at or after `fromMs` that `key` is inside a stretch; `nowMs` is when it asks. */
  opensAt(key: string, nowMs: number, fromMs: number): number
  /** How long `key` has spent inside its stretches: a clock that holds still between them. */
  clockMs(key: string, nowMs: number): number
  /** The next instant the clock of `key` crosses a whole `stepMs`, or its stretch starts or ends. */
  nextStepAt(key: string, nowMs: number, stepMs: number): number
}

/** One window of the shared sequence; every consumer's stretch sits inside it. */
interface AmbientWindow {
  readonly index: number
  readonly startMs: number
  readonly endMs: number
}

interface Span {
  readonly startMs: number
  readonly endMs: number
}

/** The keys of the consumers that are not a creature of the floor. */
export const AMBIENT_KEY = Object.freeze({
  people: 'people',
  saver: 'saver',
  standby: 'standby',
  led: 'led',
})

const AMBIENT_SEED = 20_261_025
const WINDOW_SALT = 7_919
const SPAN_SALT = 40_503
// The first window opens this long after the sequence is first asked; the rest between two
// windows and the length of one are drawn from their ranges.
const LEAD_MS = Object.freeze({ min: 9_000, max: 13_000 })
const WINDOW_MS = Object.freeze({ min: 10_000, max: 30_000 })
const REST_MS = Object.freeze({ min: 12_000, max: 60_000 })
// A consumer starts up to this share of its window late and stops no earlier than `END_MIN` of
// it, so they do not move in lockstep.
const START_LAG = 0.25
const END_MIN = 0.6
const KEEP_WINDOWS = 8
const HASH_MULTIPLIER = 0x45_d9_f3_b
const HASH_SHIFT = 16

export const ambientWindows: AmbientWindows = createAmbientWindows()

/** The sequence so far: the windows still kept, and the time each asked key spent inside the ones
 *  already let go of. */
interface Sequence {
  readonly windows: AmbientWindow[]
  readonly folded: Map<string, number>
}

function createAmbientWindows(): AmbientWindows {
  const sequence: Sequence = { windows: [], folded: new Map() }
  const isOn = (key: string, nowMs: number): boolean => {
    const span = spanOf(key, windowAt(sequence, nowMs))

    return nowMs >= span.startMs && nowMs < span.endMs
  }
  const nextAt = (key: string, nowMs: number): number => {
    for (let one = windowAt(sequence, nowMs); ; one = windowAt(sequence, one.endMs)) {
      const span = spanOf(key, one)

      if (nowMs < span.startMs) {
        return span.startMs
      }

      if (nowMs < span.endMs) {
        return span.endMs
      }
    }
  }
  return {
    isOn,
    nextAt,
    opensAt: (key, nowMs, fromMs) => opensAtIn(sequence, key, { nowMs, fromMs }),
    clockMs: (key, nowMs) => clockIn(sequence, key, nowMs),
    nextStepAt: (key, nowMs, stepMs) => {
      const edgeMs = nextAt(key, nowMs)

      return isOn(key, nowMs)
        ? Math.min(edgeMs, nowMs + Math.ceil(stepMs - (clockIn(sequence, key, nowMs) % stepMs)))
        : edgeMs
    },
  }
}

function opensAtIn(
  sequence: Sequence,
  key: string,
  at: { readonly nowMs: number; readonly fromMs: number }
): number {
  for (let one = windowAt(sequence, at.nowMs); ; one = windowAt(sequence, one.endMs)) {
    const span = spanOf(key, one)

    if (at.fromMs < span.endMs) {
      return Math.max(at.fromMs, span.startMs)
    }
  }
}

// The time `key` has spent inside its spans: those of the windows let go of, and of the kept ones
// up to `nowMs`.
function clockIn(sequence: Sequence, key: string, nowMs: number): number {
  windowAt(sequence, nowMs)

  let total = sequence.folded.get(key) ?? 0

  sequence.folded.set(key, total)

  for (const one of sequence.windows) {
    const span = spanOf(key, one)

    total += Math.max(0, Math.min(nowMs, span.endMs) - span.startMs)
  }

  return total
}

// The window `nowMs` falls in, or the next one: windows are drawn as they are asked for, and only
// the last few are kept.
function windowAt(sequence: Sequence, nowMs: number): AmbientWindow {
  const { windows, folded } = sequence

  while ((windows.at(-1)?.endMs ?? Number.NEGATIVE_INFINITY) <= nowMs) {
    windows.push(nextWindow(windows.at(-1), nowMs))
  }

  for (const gone of windows.splice(0, Math.max(0, windows.length - KEEP_WINDOWS))) {
    for (const [key, ms] of folded) {
      folded.set(key, ms + lengthOf(spanOf(key, gone)))
    }
  }

  return windows.find((one) => one.endMs > nowMs) ?? windows[0] ?? nextWindow(undefined, nowMs)
}

// The window after `prev`; the first opens a lead after the moment it is first asked for.
function nextWindow(prev: AmbientWindow | undefined, askedMs: number): AmbientWindow {
  const index = prev === undefined ? 0 : prev.index + 1
  const rng = createLcgRng(hash32(AMBIENT_SEED + index * WINDOW_SALT))
  const startMs =
    prev === undefined
      ? askedMs + between(rng.next(), LEAD_MS)
      : prev.endMs + between(rng.next(), REST_MS)

  return { index, startMs, endMs: startMs + between(rng.next(), WINDOW_MS) }
}

function spanOf(key: string, one: AmbientWindow): Span {
  const rng = createLcgRng(hash32(seedOf(key) + one.index * SPAN_SALT))
  const length = one.endMs - one.startMs

  return {
    startMs: one.startMs + rng.next() * START_LAG * length,
    endMs: one.startMs + length * (END_MIN + (1 - END_MIN) * rng.next()),
  }
}

function lengthOf(span: Span): number {
  return span.endMs - span.startMs
}

function between(draw: number, range: { readonly min: number; readonly max: number }): number {
  return range.min + draw * (range.max - range.min)
}

function hash32(value: number): number {
  let n = Math.imul(value ^ (value >>> HASH_SHIFT), HASH_MULTIPLIER)

  n = Math.imul(n ^ (n >>> HASH_SHIFT), HASH_MULTIPLIER)

  return (n ^ (n >>> HASH_SHIFT)) >>> 0
}

import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import { type ClockParts, zoneParts } from '@/web/state/clock'
import { reducedMotion } from '@/web/state/prefs'

export const CLOCK_SPEEDS = [1, 10, 60] as const
export const CLOCK_PRESET_HOURS = [6, 9 + 20 / 60, 12 + 10 / 60, 16.5, 19.5, 22.5] as const

const REAL_SPEED: ClockSpeed = 1
const MS_PER_MINUTE = 60_000
const MINUTES_PER_HOUR = 60
const MS_PER_HOUR = MS_PER_MINUTE * MINUTES_PER_HOUR
const HOURS_PER_DAY = 24
const MS_PER_DAY = MS_PER_HOUR * HOURS_PER_DAY
// Lands the minute timer just past the boundary, never just before it.
const MINUTE_EDGE_MS = 5

export type ClockSpeed = (typeof CLOCK_SPEEDS)[number]
export type ClockMode =
  | { readonly kind: 'real' }
  | { readonly kind: 'preview'; readonly hour: number; readonly speed: ClockSpeed }

/** A preview's start: `dayMs` into the day at `since` (`performance.now()`), running `speed` times. */
interface PreviewBase {
  readonly dayMs: number
  readonly since: number
  readonly speed: ClockSpeed
}

/** The real day `pageNow` wraps a preview inside, kept until the real time leaves it. */
interface RealDay {
  readonly zone: string
  readonly startMs: number
}

const mode = signal<ClockMode>({ kind: 'real' })
// The zone the scene lives in: the home market's, else the operator's `[locale] timezone`.
const zone = signal(Intl.DateTimeFormat().resolvedOptions().timeZone)
const minute = signal<ClockParts>(zoneParts(Date.now(), zone.value))
const lifetime = new AbortController()
let preview: PreviewBase | undefined
let realDay: RealDay | undefined
let minuteTimer: ReturnType<typeof setTimeout> | undefined

/** Real time, or a preview hour running at a speed; never stored, so a reload is real time. */
export const clockMode: ReadonlySignal<ClockMode> = mode
/** The page clock in the scene zone, refreshed at each page-minute boundary. */
export const pageMinute: ReadonlySignal<ClockParts> = minute

document.addEventListener('visibilitychange', syncMinute, { signal: lifetime.signal })

// Reduced motion runs a preview at normal speed from the moment it is asked for.
const stopMotionSync = effect(() => {
  if (reducedMotion.value) {
    untracked(slowPreview)
  }
})

syncMinute()

export function setClock(next: ClockMode): void {
  if (next.kind === 'real') {
    preview = undefined
    mode.value = next
  } else {
    const speed = reducedMotion.value ? REAL_SPEED : next.speed

    preview = { dayMs: next.hour * MS_PER_HOUR, since: performance.now(), speed }
    mode.value = { kind: 'preview', hour: next.hour, speed }
  }

  syncMinute()
}

export function setSceneZone(next: string): void {
  if (zone.value === next) {
    return
  }

  zone.value = next
  syncMinute()
}

/** The scene's epoch ms. A preview keeps the real date and wraps its hour inside the real day, so
 *  the day, its trades and its seeds never move under it. */
export function pageNow(): number {
  const realMs = Date.now()

  if (preview === undefined) {
    return realMs
  }

  const elapsedMs = (performance.now() - preview.since) * preview.speed

  return resolveRealDayStart(realMs) + ((preview.dayMs + elapsedMs) % MS_PER_DAY)
}

/** The page clock's hour of the day in `sceneZone`, fractional. */
export function pageHour(): number {
  return zoneParts(pageNow(), zone.value).minute / MINUTES_PER_HOUR
}

/** Releases the minute timer, its visibility listener and the motion watch; idempotent. */
export function disposeClock(): void {
  lifetime.abort()
  stopMotionSync()
  clearTimeout(minuteTimer)
  minuteTimer = undefined
}

function slowPreview(): void {
  const held = mode.value

  if (held.kind === 'preview' && held.speed !== REAL_SPEED) {
    setClock({ kind: 'preview', hour: pageHour(), speed: REAL_SPEED })
  }
}

// One timeout per page minute; a hidden tab holds none and catches up at once on return.
function syncMinute(): void {
  clearTimeout(minuteTimer)
  minuteTimer = undefined

  if (document.hidden || lifetime.signal.aborted) {
    return
  }

  const nowMs = pageNow()
  const speed = preview?.speed ?? REAL_SPEED

  minute.value = zoneParts(nowMs, zone.value)
  minuteTimer = setTimeout(
    syncMinute,
    (MS_PER_MINUTE - (nowMs % MS_PER_MINUTE)) / speed + MINUTE_EDGE_MS
  )
}

function resolveRealDayStart(realMs: number): number {
  const held = realDay
  const isHeld =
    held !== undefined &&
    held.zone === zone.value &&
    realMs >= held.startMs &&
    realMs < held.startMs + MS_PER_DAY

  if (isHeld) {
    return held.startMs
  }

  const startMs = realMs - zoneParts(realMs, zone.value).minute * MS_PER_MINUTE

  realDay = { zone: zone.value, startMs }

  return startMs
}

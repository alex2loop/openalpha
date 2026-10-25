import { type ReadonlySignal, signal } from '@preact/signals'

import { readStorage, writeStorage } from '@/web/state/storage'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DARK_QUERY = '(prefers-color-scheme: dark)'
// The page's own theme choice, when it has one, wins over the system's.
const THEME_ATTRIBUTE = 'data-theme'
const LIGHT_BY_HOUR_KEY = 'office.lightByHour'
const LAMPS_OFF_KEY = 'office.lampsOff'
const STORED_OFF = '0'

type ColorScheme = 'light' | 'dark'

const reducedMotionQuery = matchMedia(REDUCED_MOTION_QUERY)
const darkQuery = matchMedia(DARK_QUERY)
const systemReducedMotion = signal(reducedMotionQuery.matches)
const scheme = signal<ColorScheme>(resolveScheme())
const themeObserver = new MutationObserver(syncScheme)
const lifetime = new AbortController()
const switchedOff = signal<ReadonlySet<string>>(readLampsOff())

reducedMotionQuery.addEventListener(
  'change',
  (event) => {
    systemReducedMotion.value = event.matches
  },
  { signal: lifetime.signal }
)
darkQuery.addEventListener('change', syncScheme, { signal: lifetime.signal })
themeObserver.observe(document.documentElement, { attributeFilter: [THEME_ATTRIBUTE] })

/** The browser asks for less motion: bumps, pings and flashes stop. */
export const reducedMotion: ReadonlySignal<boolean> = systemReducedMotion
/** The scheme the page draws in: its own theme choice, else the system's. */
export const colorScheme: ReadonlySignal<ColorScheme> = scheme
/** The office light follows the page hour; off, it keeps the trading-day light. */
export const lightByHour: ReadonlySignal<boolean> = signal(
  readStorage('local', LIGHT_BY_HOUR_KEY) !== STORED_OFF
)
/** The rooms whose lamp switch is off; every other lamp is on. Kept in this browser only. */
export const lampsOff: ReadonlySignal<ReadonlySet<string>> = switchedOff

export function toggleLamp(room: string): void {
  const next = new Set(switchedOff.value)

  if (!next.delete(room)) {
    next.add(room)
  }

  storeLampsOff(next)
}

/** The master switch over `rooms`' lamps: every one off when any is on, else every one on. */
export function toggleAllLamps(rooms: readonly string[]): void {
  const isAnyOn = rooms.some((room) => !switchedOff.value.has(room))

  storeLampsOff(new Set(isAnyOn ? rooms : []))
}

/** Releases the media listeners and the theme observer; idempotent. */
export function disposePrefs(): void {
  lifetime.abort()
  themeObserver.disconnect()
}

function syncScheme(): void {
  scheme.value = resolveScheme()
}

function resolveScheme(): ColorScheme {
  const chosen = document.documentElement.getAttribute(THEME_ATTRIBUTE)

  if (chosen === 'light' || chosen === 'dark') {
    return chosen
  }

  return darkQuery.matches ? 'dark' : 'light'
}

function storeLampsOff(next: ReadonlySet<string>): void {
  switchedOff.value = next
  writeStorage('local', LAMPS_OFF_KEY, JSON.stringify([...next]))
}

// A stored value this page did not write reads as every lamp on.
function readLampsOff(): ReadonlySet<string> {
  try {
    const parsed: unknown = JSON.parse(readStorage('local', LAMPS_OFF_KEY) ?? '[]')

    return new Set(Array.isArray(parsed) ? parsed.filter((room) => typeof room === 'string') : [])
  } catch {
    return new Set()
  }
}

import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals'

import { readStorage, writeStorage } from '@/web/state/storage'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const DARK_QUERY = '(prefers-color-scheme: dark)'
// The page's own theme choice, when it has one, wins over the system's.
const THEME_ATTRIBUTE = 'data-theme'
const THEME_KEY = 'office.theme'
const COLOURS_KEY = 'office.colours'
const MOTION_KEY = 'office.motion'
const LIGHT_BY_HOUR_KEY = 'office.lightByHour'
const LAMPS_OFF_KEY = 'office.lampsOff'
const SCENE_VIEW_KEY = 'office.sceneView'
const DETAIL_LEVEL_KEY = 'office.detailLevel'
const CHIME_KEY = 'office.chime'
const NOTIFY_KEY = 'office.notify'
const STORED_ON = '1'
const STORED_OFF = '0'

export const THEMES = ['system', 'light', 'dark'] as const
export const COLOUR_PAIRS = ['green-up', 'red-up'] as const
export const MOTIONS = ['system', 'reduced', 'full'] as const
export const SCENE_VIEWS = ['2d', '3d'] as const
// Advanced first: it is the default, and today's reader loses nothing.
export const DETAIL_LEVELS = ['advanced', 'simple'] as const

export type Theme = (typeof THEMES)[number]
export type ColourPair = (typeof COLOUR_PAIRS)[number]
export type Motion = (typeof MOTIONS)[number]
export type SceneView = (typeof SCENE_VIEWS)[number]
export type DetailLevel = (typeof DETAIL_LEVELS)[number]
type ColorScheme = 'light' | 'dark'

const reducedMotionQuery = matchMedia(REDUCED_MOTION_QUERY)
const darkQuery = matchMedia(DARK_QUERY)
const systemReducedMotion = signal(reducedMotionQuery.matches)
const scheme = signal<ColorScheme>(resolveScheme())
const themeObserver = new MutationObserver(syncScheme)
const lifetime = new AbortController()
const themeChoice = signal<Theme>(readChoice(THEME_KEY, THEMES))
const colourChoice = signal<ColourPair>(readChoice(COLOURS_KEY, COLOUR_PAIRS))
const motionChoice = signal<Motion>(readChoice(MOTION_KEY, MOTIONS))
const sceneViewChoice = signal<SceneView>(readChoice(SCENE_VIEW_KEY, SCENE_VIEWS))
const detailChoice = signal<DetailLevel>(readChoice(DETAIL_LEVEL_KEY, DETAIL_LEVELS))
const lightByHourChoice = signal(readStorage('local', LIGHT_BY_HOUR_KEY) !== STORED_OFF)
const switchedOff = signal<ReadonlySet<string>>(readLampsOff())
const nightSwitches = signal<ReadonlyMap<string, boolean>>(new Map())
const chimeChoice = signal(readStorage('local', CHIME_KEY) === STORED_ON)
const notifyChoice = signal(readStorage('local', NOTIFY_KEY) === STORED_ON)

reducedMotionQuery.addEventListener(
  'change',
  (event) => {
    systemReducedMotion.value = event.matches
  },
  { signal: lifetime.signal }
)
darkQuery.addEventListener('change', syncScheme, { signal: lifetime.signal })
themeObserver.observe(document.documentElement, { attributeFilter: [THEME_ATTRIBUTE] })

const stopDocumentSync = effect(() => {
  const root = document.documentElement

  setOrClear(root, THEME_ATTRIBUTE, themeChoice.value === 'system' ? undefined : themeChoice.value)
  setOrClear(root, 'data-motion', motionChoice.value === 'system' ? undefined : motionChoice.value)
  root.setAttribute('data-colours', colourChoice.value)
})

/** This browser's choices, kept in local storage; a blocked store keeps them until the page closes. */
export const theme: ReadonlySignal<Theme> = themeChoice
export const colourPair: ReadonlySignal<ColourPair> = colourChoice
export const motion: ReadonlySignal<Motion> = motionChoice
/** How the office is drawn: flat 2D, or the 3D view; blocked or unknown reads as 2D. */
export const sceneView: ReadonlySignal<SceneView> = sceneViewChoice
/** How much the page spells out: simple leaves the scores, sources and technical detail folded away. */
export const detailLevel: ReadonlySignal<DetailLevel> = detailChoice
export const isAdvanced: ReadonlySignal<boolean> = computed(() => detailChoice.value === 'advanced')

/** Bumps, pings and flashes stop: the browser asks for less motion, or the operator chose it. */
export const reducedMotion: ReadonlySignal<boolean> = computed(() =>
  motionChoice.value === 'system' ? systemReducedMotion.value : motionChoice.value === 'reduced'
)
/** The scheme the page draws in: its own theme choice, else the system's. */
export const colorScheme: ReadonlySignal<ColorScheme> = scheme
/** The office light follows the page hour; off, it keeps the trading-day light. */
export const lightByHour: ReadonlySignal<boolean> = lightByHourChoice
/** The rooms whose day switch is off; every other lamp is on by day. Kept in this browser only. */
export const lampsOff: ReadonlySignal<ReadonlySet<string>> = switchedOff
/** The lamps switched on or off since dusk; unswitched, a lamp at night follows who is in. */
export const nightLamps: ReadonlySignal<ReadonlyMap<string, boolean>> = nightSwitches
/** A soft chime for what needs the operator; off until they turn it on. */
export const chime: ReadonlySignal<boolean> = chimeChoice
/** Browser notifications for what needs the operator now; off until they turn it on. */
export const notify: ReadonlySignal<boolean> = notifyChoice

export function setTheme(value: Theme): void {
  keep(themeChoice, THEME_KEY, value)
}

export function setColourPair(value: ColourPair): void {
  keep(colourChoice, COLOURS_KEY, value)
}

export function setMotion(value: Motion): void {
  keep(motionChoice, MOTION_KEY, value)
}

export function setSceneView(value: SceneView): void {
  keep(sceneViewChoice, SCENE_VIEW_KEY, value)
}

export function setDetailLevel(value: DetailLevel): void {
  keep(detailChoice, DETAIL_LEVEL_KEY, value)
}

export function setLightByHour(value: boolean): void {
  keepSwitch(lightByHourChoice, LIGHT_BY_HOUR_KEY, value)
}

export function setChime(value: boolean): void {
  keepSwitch(chimeChoice, CHIME_KEY, value)
}

export function setNotify(value: boolean): void {
  keepSwitch(notifyChoice, NOTIFY_KEY, value)
}

/** Sets the saved day switch of `rooms`' lamps. */
export function setDayLamps(rooms: readonly string[], isOn: boolean): void {
  const next = new Set(switchedOff.value)

  for (const room of rooms) {
    if (isOn) {
      next.delete(room)
    } else {
      next.add(room)
    }
  }

  storeLampsOff(next)
}

/** Sets `rooms`' lamps for the night under way, for this visit only. */
export function setNightLamps(rooms: readonly string[], isOn: boolean): void {
  const next = new Map(nightSwitches.value)

  for (const room of rooms) {
    next.set(room, isOn)
  }

  nightSwitches.value = next
}

/** Dawn or dusk: the switches made over the night are forgotten. */
export function forgetNightLamps(): void {
  if (nightSwitches.value.size > 0) {
    nightSwitches.value = new Map()
  }
}

/** Releases the media listeners, the theme observer and the document sync; idempotent. */
export function disposePrefs(): void {
  lifetime.abort()
  themeObserver.disconnect()
  stopDocumentSync()
}

function keep<T extends string>(target: Signal<T>, key: string, value: T): void {
  target.value = value
  writeStorage('local', key, value)
}

function keepSwitch(target: Signal<boolean>, key: string, value: boolean): void {
  target.value = value
  writeStorage('local', key, value ? STORED_ON : STORED_OFF)
}

// A stored value the page no longer offers reads as the first option, which is the default.
function readChoice<T extends string>(key: string, options: readonly [T, ...T[]]): T {
  const stored = readStorage('local', key)

  return options.find((option) => option === stored) ?? options[0]
}

function setOrClear(root: HTMLElement, name: string, value: string | undefined): void {
  if (value === undefined) {
    root.removeAttribute(name)
  } else {
    root.setAttribute(name, value)
  }
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

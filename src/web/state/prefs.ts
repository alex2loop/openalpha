import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals'

import { readStorage, writeStorage } from '@/web/state/storage'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
const THEME_KEY = 'office.theme'
const COLOURS_KEY = 'office.colours'
const MOTION_KEY = 'office.motion'

export const THEMES = ['system', 'light', 'dark'] as const
export const COLOUR_PAIRS = ['green-up', 'red-up'] as const
export const MOTIONS = ['system', 'reduced', 'full'] as const

export type Theme = (typeof THEMES)[number]
export type ColourPair = (typeof COLOUR_PAIRS)[number]
export type Motion = (typeof MOTIONS)[number]

const reducedMotionQuery = matchMedia(REDUCED_MOTION_QUERY)
const systemReducedMotion = signal(reducedMotionQuery.matches)
const lifetime = new AbortController()
const themeChoice = signal<Theme>(readChoice(THEME_KEY, THEMES))
const colourChoice = signal<ColourPair>(readChoice(COLOURS_KEY, COLOUR_PAIRS))
const motionChoice = signal<Motion>(readChoice(MOTION_KEY, MOTIONS))

reducedMotionQuery.addEventListener(
  'change',
  (event) => {
    systemReducedMotion.value = event.matches
  },
  { signal: lifetime.signal }
)

const stopDocumentSync = effect(() => {
  const root = document.documentElement

  setOrClear(root, 'data-theme', themeChoice.value === 'system' ? undefined : themeChoice.value)
  setOrClear(root, 'data-motion', motionChoice.value === 'system' ? undefined : motionChoice.value)
  root.setAttribute('data-colours', colourChoice.value)
})

/** This browser's choices, kept in local storage; a blocked store keeps them until the page closes. */
export const theme: ReadonlySignal<Theme> = themeChoice
export const colourPair: ReadonlySignal<ColourPair> = colourChoice
export const motion: ReadonlySignal<Motion> = motionChoice

/** Bumps, pings and flashes stop: the browser asks for less motion, or the operator chose it. */
export const reducedMotion: ReadonlySignal<boolean> = computed(() =>
  motionChoice.value === 'system' ? systemReducedMotion.value : motionChoice.value === 'reduced'
)

export function setTheme(value: Theme): void {
  keep(themeChoice, THEME_KEY, value)
}

export function setColourPair(value: ColourPair): void {
  keep(colourChoice, COLOURS_KEY, value)
}

export function setMotion(value: Motion): void {
  keep(motionChoice, MOTION_KEY, value)
}

/** Releases the media listener and the document sync; idempotent. */
export function disposePrefs(): void {
  lifetime.abort()
  stopDocumentSync()
}

function keep<T extends string>(target: Signal<T>, key: string, value: T): void {
  target.value = value
  writeStorage('local', key, value)
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

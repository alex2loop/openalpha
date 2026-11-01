import { computed, effect, type ReadonlySignal, signal } from '@preact/signals'

import type { WeatherNow } from '@/web/scene/sky-types'
import { startPoll } from '@/web/api/poll'
import { clockMode, pageMinute } from '@/web/scene/clock/clock'
import { regionPack } from '@/web/scene/data/home'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { reducedMotion } from '@/web/state/prefs'

/** The forecast API the page itself calls; it sends only the city's latitude and longitude. */
export const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast'
const WEATHER_CURRENT = 'temperature_2m,precipitation,rain,cloud_cover,weather_code'
/** How often the page asks for the weather. */
export const WEATHER_POLL_MS = 1_800_000
const WEATHER_TIMEOUT_MS = 8_000
// The poll runs on a different clock from the guard's, so a run landing just short still calls.
const WEATHER_CALL_SLACK_MS = 60_000
const WEATHER_MAX_AGE_MS = 10_800_000
const PERCENT = 100
// Rain intensity from mm an hour: a drizzle under 0.5, heavy over 4; a rain code with less water
// still shows this much.
const RAIN_CURVE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0.25],
  [4, 0.75],
  [10, 1],
]
const RAINING_FROM_MM = 0.1
const RAIN_CODE_FLOOR = 0.2
// WMO weather codes: fog, drizzle, rain, showers, thunderstorms.
const FOG_CODES: ReadonlySet<number> = new Set([45, 48])
const WET_CODE_RANGES: readonly (readonly [number, number])[] = [
  [51, 57],
  [61, 67],
  [80, 82],
  [95, 99],
]
const THUNDER_CODES = Object.freeze({ from: 95, to: 99 })
// The seeded day: 0 to 2 rain windows of 20 to 60 minutes between 05:30 and 20:30, a mild cloud
// cover, and more of it while it rains.
const SEED = Object.freeze({
  windows: [0, 1, 1, 2] as const,
  fromMin: 330,
  untilMin: 1230,
  lengthMin: 20,
  lengthSpan: 41,
  gapMin: 60,
  rain: 0.25,
  rainSpan: 0.5,
  cloud: 0.15,
  cloudSpan: 0.25,
  rainCloud: 0.85,
})

interface Reading {
  readonly now: WeatherNow
  readonly atMs: number
}

interface SeededDay {
  readonly windows: readonly (readonly [number, number, number])[]
  readonly cloud: number
}

const reading = signal<Reading | undefined>(undefined)
// One call at most a poll period apart, however often the poll is restarted.
let lastCallAt = Number.NEGATIVE_INFINITY

/** The weather the office shows: the last live reading in real time with motion not reduced
 *  while it is under `WEATHER_MAX_AGE_MS` old, else the day's seeded weather. */
export const weather: ReadonlySignal<WeatherNow> = computed(() => {
  const held = reading.value
  const { day, minute } = pageMinute.value
  const isFresh = held !== undefined && Date.now() - held.atMs <= WEATHER_MAX_AGE_MS

  return clockMode.value.kind === 'real' && !reducedMotion.value && isFresh
    ? held.now
    : seededAt(seededDayOf(day, regionPack.value.id), minute)
})

/** When the live reading shown was taken (epoch ms); absent while the seeded weather shows. */
export const weatherReadAt: ReadonlySignal<number | undefined> = computed(() =>
  weather.value.source === 'live' ? reading.value?.atMs : undefined
)

/** It is raining now: over 0.1 mm, or a rain, drizzle or thunder code. */
export function raining(): boolean {
  return weather.peek().rain > 0
}

/** Polls the forecast while the clock is real and motion is not reduced; the returned stop
 *  releases the poll and the watch. */
export function startWeather(): () => void {
  let stopPoll: (() => void) | undefined

  const stopWatch = effect(() => {
    const isLive = clockMode.value.kind === 'real' && !reducedMotion.value
    const geo = regionPack.value.geo

    stopPoll?.()
    stopPoll = isLive
      ? startPoll((pollSignal) => loadWeather(geo, pollSignal), WEATHER_POLL_MS)
      : undefined
  })

  return () => {
    stopWatch()
    stopPoll?.()
    stopPoll = undefined
  }
}

// A failed or malformed answer keeps the last good reading; `weather` lets it age out.
async function loadWeather(
  geo: { readonly lat: number; readonly lon: number },
  pollSignal: AbortSignal
): Promise<void> {
  const nowMs = Date.now()

  if (nowMs - lastCallAt < WEATHER_POLL_MS - WEATHER_CALL_SLACK_MS) {
    return
  }

  lastCallAt = nowMs

  const url = new URL(WEATHER_URL)

  url.search = new URLSearchParams({
    latitude: String(geo.lat),
    longitude: String(geo.lon),
    current: WEATHER_CURRENT,
    timezone: 'auto',
  }).toString()

  try {
    const response = await fetch(url, {
      signal: AbortSignal.any([pollSignal, AbortSignal.timeout(WEATHER_TIMEOUT_MS)]),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
    const now = response.ok ? toWeather(await response.json()) : undefined

    if (now !== undefined) {
      reading.value = { now, atMs: Date.now() }
    }
  } catch {
    // Offline, blocked or timed out: the last reading stands until it ages out.
  }
}

function toWeather(body: unknown): WeatherNow | undefined {
  // An unknown body: every field read below is checked for a finite number before use.
  const current = (body as { current?: Record<string, unknown> } | null)?.current
  const temp = current?.temperature_2m
  const mm = current?.precipitation
  const cloud = current?.cloud_cover
  const code = current?.weather_code

  if (
    !(isFiniteNumber(temp) && isFiniteNumber(mm) && isFiniteNumber(cloud) && isFiniteNumber(code))
  ) {
    return undefined
  }

  const isWetCode = WET_CODE_RANGES.some(([from, to]) => code >= from && code <= to)
  const water = Math.max(0, mm)
  const isRaining = water > RAINING_FROM_MM || isWetCode

  return {
    rain: isRaining ? Math.max(RAIN_CODE_FLOOR, rainOf(water)) : 0,
    thunder: code >= THUNDER_CODES.from && code <= THUNDER_CODES.to,
    tempC: temp,
    cloud: Math.min(1, Math.max(0, cloud / PERCENT)),
    fog: FOG_CODES.has(code),
    source: 'live',
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function rainOf(mm: number): number {
  const next = RAIN_CURVE.findIndex(([from]) => from > mm)

  if (next < 0) {
    return 1
  }

  const [a0, a1] = RAIN_CURVE[next - 1] ?? [0, 0]
  const [b0, b1] = RAIN_CURVE[next] ?? [a0, a1]

  return a1 + ((b1 - a1) * (mm - a0)) / (b0 - a0)
}

// One day's seeded windows, kept for the day: the computed above asks every page minute.
let seededKey = ''
let seededDay: SeededDay = { windows: [], cloud: SEED.cloud }

function seededDayOf(day: string, region: string): SeededDay {
  const key = `${day}|${region}`

  if (key === seededKey) {
    return seededDay
  }

  const rng = createRng(seedOf(day, region, 'weather'))
  const count = SEED.windows[rng.int(0, SEED.windows.length - 1)] ?? 0
  const windows: [number, number, number][] = []
  let from = SEED.fromMin

  for (let index = 0; index < count; index++) {
    const length = SEED.lengthMin + rng.int(0, SEED.lengthSpan - 1)
    const start = from + Math.floor(rng.next() * Math.max(0, SEED.untilMin - from - length * 2))

    windows.push([start, start + length, SEED.rain + rng.next() * SEED.rainSpan])
    from = start + length + SEED.gapMin
  }

  seededKey = key
  seededDay = { windows, cloud: SEED.cloud + rng.next() * SEED.cloudSpan }

  return seededDay
}

function seededAt(day: SeededDay, minute: number): WeatherNow {
  const window = day.windows.find(([from, until]) => minute >= from && minute < until)

  return {
    rain: window?.[2] ?? 0,
    thunder: false,
    cloud: window === undefined ? day.cloud : SEED.rainCloud,
    fog: false,
    source: 'seeded',
  }
}

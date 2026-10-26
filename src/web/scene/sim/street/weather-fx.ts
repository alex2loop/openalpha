import type { Ped, Peds } from '@/web/scene/sim/street/ped-walk'
import type { WeatherFxView } from '@/web/scene/sky-types'
import type { Point } from '@/web/scene/types'
import { raining, weather } from '@/web/scene/data/weather'
import { skyNow } from '@/web/scene/sim/sky'
import { sheltersOf } from '@/web/scene/sim/street/flows'
import {
  addPoint,
  clearRoute,
  countTask,
  PAVEMENT,
  WALK_REACH_PX,
} from '@/web/scene/sim/street/ped-walk'
import { UMBRELLA_LOOKS } from '@/web/scene/street-types'
import { WORLD } from '@/web/scene/types'
import { isShopOpen, type RegionPack, shopDoorOf } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'

/** At this air temperature with the sun up, the street keeps to its heat habits. */
const HEAT_C = 33
// A strike at most every 20 to 40 s while it thunders, the first a few seconds in.
const FLASH_GAP_MS = Object.freeze({ min: 20_000, span: 20_000 })
const FIRST_FLASH_MS = Object.freeze({ min: 2_000, span: 6_000 })
// About 40% of walkers open an umbrella in a moderate rain; those without one hurry.
const UMBRELLA_SHARE = Object.freeze({ base: 0.12, perRain: 0.5 })
const RAIN_HURRY = 1.35
// Up to 3 walkers duck under a shelter or an awning while it rains, 15 to 50 s each.
const MAX_SHELTERING = 3
const SHELTER_MS = Object.freeze({ min: 15_000, span: 35_000 })
const SHELTER_CHECK_MS = 1_000
const SHELTER_CHANCE = Object.freeze({ rain: 0.05, thunder: 0.35 })
const SHELTER_REACH_PX = 150
const SHELTER_SPOT_PX = 2.6
const SHELTER_OFFSETS = [-5, 1, 6] as const
const AWNING_OFFSETS = [-6, 6] as const
const AWNING_Y = PAVEMENT.door + 1
const SHELTER_Y = PAVEMENT.farKerb - 0.9
// In the heat: a conical hat or a cap on most heads, and the shady side of the far pavement.
const HAT_SHARES = Object.freeze({ conical: 0.38, cap: 0.68 })
const SHADE_Y = PAVEMENT.far - 1.6

/** The street's weather state, written only by the street sim; `view` is what the painter and
 *  the windows read. */
export interface WeatherFx {
  readonly view: { -readonly [K in keyof WeatherFxView]: WeatherFxView[K] }
  rng: ReturnType<typeof createRng>
  /** Moves on each switch of rain or heat; a walker dressed for an older one is dressed again. */
  epoch: number
  isRaining: boolean
  thunder: boolean
  nextFlashAt: number
  shelterCheckAt: number
}

export function createWeatherFx(): WeatherFx {
  return {
    view: {
      falling: 0,
      rain: 0,
      fog: false,
      isHeat: false,
      flashAt: Number.NEGATIVE_INFINITY,
      atMs: 0,
    },
    rng: createRng(0),
    epoch: 0,
    isRaining: false,
    thunder: false,
    nextFlashAt: Number.POSITIVE_INFINITY,
    shelterCheckAt: 0,
  }
}

/** Reseeds the weather's chance from the clock, so a rebuilt street dresses the same way. */
export function resetWeatherFx(
  fx: WeatherFx,
  at: { readonly pack: RegionPack; readonly day: string; readonly minute: number }
): void {
  fx.rng = createRng(seedOf(at.day, at.pack.id, 'weather-fx', String(Math.floor(at.minute))))
  fx.epoch++
  fx.view.flashAt = Number.NEGATIVE_INFINITY
}

/** Follows the weather now: rain, fog, heat and thunder's next strike; then dresses every walker
 *  for it. True when lightning just struck. */
export function syncWeatherFx(
  fx: WeatherFx,
  at: { readonly peds: Peds; readonly nowMs: number; readonly isReduced: boolean }
): boolean {
  const now = weather.peek()
  const isSunUp = skyNow.peek().light.sun.altitudeDeg > 0
  const isRaining = raining()
  const isHeat = now.tempC !== undefined && now.tempC >= HEAT_C && isSunUp
  const thunder = now.thunder && isRaining && !at.isReduced
  const { view } = fx

  if (isRaining !== fx.isRaining || isHeat !== view.isHeat) {
    fx.epoch++
  }

  fx.isRaining = isRaining
  view.rain = now.rain
  view.falling = at.isReduced ? 0 : now.rain
  view.fog = now.fog
  view.isHeat = isHeat
  view.atMs = at.nowMs
  at.peds.weather.isRaining = isRaining
  at.peds.weather.isHeat = isHeat

  for (const ped of at.peds.pool) {
    if (ped.on && ped.dressed !== fx.epoch) {
      dress(fx, ped)
    }
  }

  return strike(fx, { thunder, nowMs: at.nowMs })
}

/** The next lightning strike while it thunders, a `performance.now()` instant. */
export function nextFlashAt(fx: WeatherFx): number {
  return fx.thunder ? fx.nextFlashAt : Number.POSITIVE_INFINITY
}

/** While it rains, now and then a walker on the far pavement heads for the nearest free shelter
 *  or open awning; a thunderstorm sends them all at once. */
export function stepWeatherPeds(
  fx: WeatherFx,
  at: {
    readonly peds: Peds
    readonly pack: RegionPack
    readonly minute: number
    readonly nowMs: number
  }
): void {
  if (!fx.isRaining || at.nowMs < fx.shelterCheckAt) {
    return
  }

  fx.shelterCheckAt = at.nowMs + SHELTER_CHECK_MS

  const chance = fx.thunder ? SHELTER_CHANCE.thunder : SHELTER_CHANCE.rain

  if (fx.rng.next() < chance) {
    sendToShelter(at)
  }
}

/** A walker reaching cover waits out the rain there, then walks on to an end of the pavement;
 *  true when the arrival was theirs. */
export function arriveAtShelter(peds: Peds, ped: Ped, nowMs: number): boolean {
  if (ped.task !== 'shelter' || ped.holdUntil > 0) {
    return false
  }

  const end = peds.rng.next() < 0.5 ? -WALK_REACH_PX : WORLD.w + WALK_REACH_PX

  ped.holdUntil = nowMs + SHELTER_MS.min + peds.rng.next() * SHELTER_MS.span
  ped.facing = 'south'
  clearRoute(ped)
  addPoint(ped, ped.at.x, PAVEMENT.far)
  addPoint(ped, end, PAVEMENT.far)

  return true
}

// An umbrella and a quicker step in the rain; a hat and the shady side in the heat.
function dress(fx: WeatherFx, ped: Ped): void {
  const isStreetWalker = ped.kind === 'walker' || ped.kind === 'pupil'
  const umbrellaShare = UMBRELLA_SHARE.base + UMBRELLA_SHARE.perRain * fx.view.rain

  ped.dressed = fx.epoch
  ped.umbrella =
    fx.isRaining && isStreetWalker && fx.rng.next() < umbrellaShare
      ? 1 + fx.rng.int(0, UMBRELLA_LOOKS - 1)
      : 0

  const isHurried = fx.isRaining && ped.umbrella === 0 && ped.kind === 'walker'

  if (isHurried !== ped.isHurried) {
    ped.speed = isHurried ? ped.speed * RAIN_HURRY : ped.speed / RAIN_HURRY
    ped.isHurried = isHurried
  }

  ped.hat = fx.view.isHeat && isStreetWalker ? hatOf(fx.rng.next()) : 0

  if (fx.view.isHeat && ped.kind === 'walker') {
    keepToShade(ped)
  }
}

// The rest of the walk along the far pavement moves to its shady side.
function keepToShade(ped: Ped): void {
  for (let index = ped.leg; index < ped.routeLength; index++) {
    const point = ped.route[index]

    if (point !== undefined && point.y === PAVEMENT.far) {
      point.y = SHADE_Y
    }
  }
}

function hatOf(roll: number): number {
  if (roll < HAT_SHARES.conical) {
    return 1
  }

  return roll < HAT_SHARES.cap ? 2 : 0
}

function strike(fx: WeatherFx, at: { readonly thunder: boolean; readonly nowMs: number }): boolean {
  if (!at.thunder) {
    fx.thunder = false
    fx.nextFlashAt = Number.POSITIVE_INFINITY
    return false
  }

  if (!fx.thunder) {
    fx.thunder = true
    fx.nextFlashAt = at.nowMs + FIRST_FLASH_MS.min + fx.rng.next() * FIRST_FLASH_MS.span
    fx.shelterCheckAt = 0
  }

  if (at.nowMs < fx.nextFlashAt) {
    return false
  }

  fx.view.flashAt = at.nowMs
  fx.nextFlashAt = at.nowMs + FLASH_GAP_MS.min + fx.rng.next() * FLASH_GAP_MS.span

  return true
}

function sendToShelter(at: {
  readonly peds: Peds
  readonly pack: RegionPack
  readonly minute: number
  readonly nowMs: number
}): void {
  if (countTask(at.peds, 'shelter') >= MAX_SHELTERING) {
    return
  }

  const walker = at.peds.pool.find(
    (ped) =>
      ped.on &&
      ped.kind === 'walker' &&
      ped.task === 'walk' &&
      ped.holdUntil <= at.nowMs &&
      Math.abs(ped.at.y - PAVEMENT.far) < 1
  )
  const spot = walker === undefined ? undefined : freeSpotNear(at, walker.at)

  if (walker === undefined || spot === undefined) {
    return
  }

  walker.task = 'shelter'
  walker.holdUntil = 0
  clearRoute(walker)
  addPoint(walker, spot.x, PAVEMENT.far)
  addPoint(walker, spot.x, spot.y)
}

// The nearest far shelter spot or open shop awning within reach that nobody waits at or heads for.
function freeSpotNear(
  at: { readonly peds: Peds; readonly pack: RegionPack; readonly minute: number },
  from: Point
): Point | undefined {
  let best: Point | undefined
  let bestDistance = SHELTER_REACH_PX
  const consider = (x: number, y: number): void => {
    const distance = Math.abs(x - from.x)

    if (distance < bestDistance && !isTaken(at.peds, x)) {
      best = { x, y }
      bestDistance = distance
    }
  }

  for (const shelter of sheltersOf(at.pack)) {
    if (shelter.stop.side === 'far') {
      for (const offset of SHELTER_OFFSETS) {
        consider(shelter.x + offset, SHELTER_Y)
      }
    }
  }

  for (const [index, row] of at.pack.shops.entries()) {
    if (row.kind !== 'lobby' && isShopOpen(row, at.minute)) {
      const door = shopDoorOf(at.pack.shops, index)

      for (const offset of AWNING_OFFSETS) {
        consider(door.x + offset, AWNING_Y)
      }
    }
  }

  return best
}

function isTaken(peds: Peds, x: number): boolean {
  for (const ped of peds.pool) {
    const heading = ped.route[ped.routeLength - 1]
    const spotX = ped.holdUntil > 0 ? ped.at.x : heading?.x

    if (
      ped.on &&
      ped.task === 'shelter' &&
      spotX !== undefined &&
      Math.abs(spotX - x) < SHELTER_SPOT_PX
    ) {
      return true
    }
  }

  return false
}

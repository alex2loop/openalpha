import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { WeatherFxView } from '@/web/scene/sky-types'
import type { PersonView, SignalHeadId, SignalState, StreetView } from '@/web/scene/street-types'
import type { Point, Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { stepErrandsStreet } from '@/web/scene/sim/street/errand-walk'
import { type Errands, endErrands } from '@/web/scene/sim/street/errands'
import {
  createFront,
  type Front,
  isFrontMoving,
  isFrontShown,
  nextPanelAt,
  resetFront,
  stepFront,
} from '@/web/scene/sim/street/front'
import {
  createLife,
  isLifeMovingIn,
  resetLife,
  type StreetLife,
  stepLife,
} from '@/web/scene/sim/street/life'
import { createLot, type Lot, resetLot, stepLot } from '@/web/scene/sim/street/lot'
import { hasPedChanged, type Ped, type Peds } from '@/web/scene/sim/street/ped-walk'
import { createPeds, resetPeds, stepPeds } from '@/web/scene/sim/street/peds'
import {
  isSameSignal,
  nextSignalChangeAt,
  SIGNAL_HEADS,
  signalHeadsOf,
  signalOf,
} from '@/web/scene/sim/street/signals'
import {
  createTraffic,
  insertByY,
  resetTraffic,
  stepTraffic,
  type Traffic,
} from '@/web/scene/sim/street/traffic'
import {
  createWeatherFx,
  nextFlashAt,
  resetWeatherFx,
  stepWeatherPeds,
  syncWeatherFx,
  type WeatherFx,
} from '@/web/scene/sim/street/weather-fx'
import { WORLD } from '@/web/scene/types'
import { movingRectOf, visibleRect } from '@/web/scene/view'
import { isInside } from '@/web/scene/world/rooms'

const KEY_SEPARATOR = '|'
// While nothing on the street shows, it steps itself this often, out of sight, and wakes the loop
// only when something comes into view.
const ARRIVAL_CHECK_MS = 1_000
// The most steps one arrival check catches up; older time is dropped, never replayed.
const MAX_CATCH_UP_STEPS = 20

/** The one street both renderers show: its pools, stepped with the office; `stepMs` is the last
 *  step's time. */
export interface Street {
  /** Advances the street one sim step; true while something in view moved. */
  step(nowMs: number): boolean
  view(): StreetView
  /** Rebuilds the pools from the clock and the keyed seeds, never replaying missed steps. */
  resume(): void
  stepMs(): number
  /** The next step while something in view moves, a `performance.now()` instant; `Infinity`
   *  while nothing on the street shows. */
  nextDueAt(): number
  /** Steps the street out of sight while the loop sleeps and calls `wake` once something comes
   *  into view; the returned stop releases its timer. */
  watchArrivals(wake: () => void): () => void
  dispose(): void
}

interface StreetDeps {
  readonly pack: ReadonlySignal<RegionPack>
  readonly reduced: ReadonlySignal<boolean>
  readonly errands: Errands
}

interface StreetState {
  readonly deps: StreetDeps
  readonly traffic: Traffic
  readonly lot: Lot
  readonly front: Front
  readonly peds: Peds
  readonly life: StreetLife
  readonly weather: WeatherFx
  /** Everyone on the street now, north to south: the pools' people and anyone out on an errand. */
  readonly people: Ped[]
  readonly view: StreetView & {
    step: number
    heads: StreetView['heads']
    readonly signals: Record<SignalHeadId, SignalState>
  }
  stepMs: number
  lastStepAt: number
  isLotMoving: boolean
  isShowing: boolean
  isHeadShown: boolean
  hasSignalChanged: boolean
  isFrontShown: boolean
  isFrontMoving: boolean
  hasFrontChanged: boolean
  /** Someone came back in from an errand while the loop slept: the floor walks them in. */
  hasErrandCome: boolean
}

/** The street of the home region's pack; a day, region or zone change rebuilds it. Under reduced
 *  motion it stands still as the clock placed it. */
export function createStreet(deps: StreetDeps): Street {
  const state = createStreetState(deps)
  let placeKey = ''

  const resume = (): void => resumeStreet(state)
  const stopWatch = effect(() => {
    const key = [deps.pack.value.id, pageMinute.value.day, sceneZone.value].join(KEY_SEPARATOR)

    if (key !== placeKey) {
      placeKey = key
      untracked(resume)
    }
  })

  return {
    step: (nowMs) => stepStreet(state, nowMs),
    view: () => state.view,
    resume,
    stepMs: () => state.stepMs,
    nextDueAt: () => nextDueOf(state),
    watchArrivals: (wake) => watchArrivals(state, wake),
    dispose: stopWatch,
  }
}

// Every pool empty and every flag down, until the first resume places the street.
function createStreetState(deps: StreetDeps): StreetState {
  const traffic = createTraffic(deps.pack.peek())
  const lot = createLot()
  const front = createFront()
  const people: Ped[] = []
  const life = createLife(traffic, people)
  const weather = createWeatherFx()

  return {
    deps,
    traffic,
    lot,
    front,
    peds: createPeds(),
    life,
    weather,
    people,
    view: createView({
      traffic,
      lot,
      front,
      people,
      life,
      weather: weather.view,
      pack: deps.pack.peek(),
    }),
    stepMs: 0,
    lastStepAt: 0,
    isLotMoving: false,
    isShowing: false,
    isHeadShown: false,
    hasSignalChanged: false,
    isFrontShown: false,
    isFrontMoving: false,
    hasFrontChanged: false,
    hasErrandCome: false,
  }
}

// The snapshot the painter reads: the pools' own arrays, filled in place by each step.
function createView(at: {
  readonly traffic: Traffic
  readonly lot: Lot
  readonly front: Front
  readonly people: readonly PersonView[]
  readonly life: StreetLife
  readonly weather: WeatherFxView
  readonly pack: RegionPack
}): StreetState['view'] {
  const { traffic, lot, front } = at

  return {
    step: 0,
    heads: signalHeadsOf(at.pack),
    pools: { vehicles: traffic.shown, people: at.people, critters: at.life.critters.shown },
    signals: {
      north: signalOf('north', 0),
      side: signalOf('side', 0),
      walk: signalOf('walk', 0),
    },
    says: traffic.saying,
    lot: lot.view,
    front: front.view,
    vendors: at.life.vendors.view,
    weather: at.weather,
  }
}

function resumeStreet(state: StreetState): void {
  const nowMs = performance.now()
  const { day, minute } = pageMinute.peek()
  const pack = state.deps.pack.peek()

  endErrands(state.deps.errands)
  resetTraffic(state.traffic, { pack, day, minute, nowMs })
  resetLot(state.lot, { pack, minute })
  resetFront(state.front, { pack, day, nowMs })
  resetPeds(state.peds, { pack, day, minute, nowMs })
  resetLife(state.life, { pack, day, minute, nowMs })
  resetWeatherFx(state.weather, { pack, day, minute })
  syncWeatherFx(state.weather, { peds: state.peds, nowMs, isReduced: state.deps.reduced.peek() })
  syncPeople(state)
  state.view.heads = signalHeadsOf(pack)
  syncSignals(state.view.signals, state.deps.reduced.peek() ? 0 : nowMs)
  state.lastStepAt = nowMs
  state.isShowing = false
  state.view.step++
}

function stepStreet(state: StreetState, nowMs: number): boolean {
  const startedAt = performance.now()
  const isReduced = state.deps.reduced.peek()
  const rect = movingRectOf(visibleRect())

  const hasStruck = syncWeatherFx(state.weather, { peds: state.peds, nowMs, isReduced })

  state.isShowing = false
  state.isHeadShown = false

  if (isReduced) {
    state.hasFrontChanged = stepFront(state.front, {
      pack: state.traffic.pack,
      nowMs,
      isReduced,
    })
  } else {
    stepAll(state, nowMs)
    state.isShowing = isMovingInView(state, rect)
    state.isHeadShown = isAnyIn(state.view.heads, rect)
  }

  state.isFrontShown = isFrontShown(state.front.view, rect)
  state.isFrontMoving = isFrontMoving(state.front, rect)

  const isRepaint =
    state.isShowing ||
    state.isFrontMoving ||
    (state.isHeadShown && state.hasSignalChanged) ||
    (state.isFrontShown && state.hasFrontChanged)

  if (isRepaint) {
    state.view.step++
  }

  state.stepMs = performance.now() - startedAt

  return isRepaint || hasStruck
}

// The next step while traffic or the front moves in view; else the sooner of a head's next lamp
// or digit change and the board's next panel, each when in view; else none.
function nextDueOf(state: StreetState): number {
  if (state.deps.reduced.peek()) {
    return Number.POSITIVE_INFINITY
  }

  if (state.isShowing || state.isFrontMoving) {
    return state.lastStepAt + SIM_STEP_MS
  }

  const nowMs = performance.now()
  const headAt = state.isHeadShown ? nextSignalChangeAt(nowMs) : Number.POSITIVE_INFINITY
  const panelAt = state.isFrontShown ? nextPanelAt(state.front, nowMs) : Number.POSITIVE_INFINITY

  return Math.min(headAt, panelAt, nextFlashAt(state.weather))
}

function stepAll(state: StreetState, nowMs: number): void {
  const { traffic } = state
  const { minute } = pageMinute.peek()

  stepTraffic(traffic, { minute, nowMs })
  stepPeds(state.peds, { traffic, minute, nowMs, dt: traffic.tick.dt })
  stepWeatherPeds(state.weather, { peds: state.peds, pack: traffic.pack, minute, nowMs })
  state.hasErrandCome =
    stepErrandsStreet(state.deps.errands, { traffic, minute, nowMs, dt: traffic.tick.dt }) ||
    state.hasErrandCome
  stepLife(state.life, traffic)
  syncPeople(state)
  state.hasSignalChanged = syncSignals(state.view.signals, nowMs)
  state.isLotMoving = stepLot(state.lot, { pack: traffic.pack, minute, nowMs, dt: traffic.tick.dt })
  state.hasFrontChanged = stepFront(state.front, { pack: traffic.pack, nowMs, isReduced: false })
  state.lastStepAt = nowMs
}

// A sim-only check: it never draws, and wakes the loop only for something that came into view.
function watchArrivals(state: StreetState, wake: () => void): () => void {
  const timer = setInterval(() => {
    const nowMs = performance.now()
    const isLoopStepping = nowMs - state.lastStepAt < ARRIVAL_CHECK_MS

    if (document.hidden || state.deps.reduced.peek() || isLoopStepping) {
      return
    }

    state.hasErrandCome = false
    catchUp(state, nowMs)

    const rect = movingRectOf(visibleRect())

    if (state.hasErrandCome || isMovingInView(state, rect) || isFrontMoving(state.front, rect)) {
      wake()
    }
  }, ARRIVAL_CHECK_MS)

  return () => clearInterval(timer)
}

function catchUp(state: StreetState, nowMs: number): void {
  const steps = Math.min(MAX_CATCH_UP_STEPS, Math.floor((nowMs - state.lastStepAt) / SIM_STEP_MS))
  const from = nowMs - steps * SIM_STEP_MS

  for (let index = 1; index <= steps; index++) {
    stepAll(state, from + index * SIM_STEP_MS)
  }
}

// A vehicle in view, someone walking or waving there, an animal or the flower bicycle moving
// there, steam over a pot there, or the attendant walking there; parked bikes and people standing
// still never keep it awake.
function isMovingInView(state: StreetState, rect: Rect): boolean {
  if (
    isAnyIn(state.traffic.shown, rect) ||
    isLifeMovingIn(state.life, rect) ||
    isRainIn(state.view.weather, rect)
  ) {
    return true
  }

  for (const person of state.people) {
    if (hasPedChanged(person) && isInside(rect, person.at)) {
      return true
    }
  }

  const { attendant } = state.lot.view

  return state.isLotMoving && attendant !== undefined && isInside(rect, attendant.at)
}

// The pools' people and anyone out on an errand, north to south, the order they are drawn in.
function syncPeople(state: StreetState): void {
  const { people } = state

  people.length = 0

  for (const ped of state.peds.pool) {
    if (ped.on) {
      insertByY(people, ped)
    }
  }

  for (const crowd of state.life.crowds) {
    for (const ped of crowd) {
      if (ped.on) {
        insertByY(people, ped)
      }
    }
  }

  for (const errand of state.deps.errands.slots) {
    if (errand.ped.on) {
      insertByY(people, errand.ped)
    }
  }
}

// True when any head now shows another lamp or another second.
function syncSignals(signals: Record<SignalHeadId, SignalState>, nowMs: number): boolean {
  let hasChanged = false

  for (const head of SIGNAL_HEADS) {
    const next = signalOf(head, nowMs)

    hasChanged = hasChanged || !isSameSignal(signals[head], next)
    signals[head] = next
  }

  return hasChanged
}

/** Something stands on the street within `rect`: a vehicle, a person, an animal, the flower
 *  bicycle or a steaming pot, a parked motorbike, the lot's attendant, a signal head, the board,
 *  a shutter on the move or the guard on the front, or rain falling outside the building. */
export function hasStreetEntities(view: StreetView, rect: Rect): boolean {
  const { pools, lot, vendors } = view

  if (
    isAnyIn(pools.vehicles, rect) ||
    isAnyIn(pools.people, rect) ||
    isAnyIn(pools.critters, rect) ||
    (vendors.bike !== undefined && isInside(rect, vendors.bike.at)) ||
    (vendors.pot !== undefined && isInside(rect, vendors.pot)) ||
    isRainIn(view.weather, rect)
  ) {
    return true
  }

  for (let index = 0; index < lot.parked; index++) {
    const slot = lot.slots[index]

    if (slot !== undefined && isInside(rect, slot)) {
      return true
    }
  }

  return (
    (lot.attendant !== undefined && isInside(rect, lot.attendant.at)) ||
    isAnyIn(view.heads, rect) ||
    isFrontShown(view.front, rect)
  )
}

// Rain falls where `rect` reaches past the building, whose floor hides the street under it.
function isRainIn(weather: WeatherFxView, rect: Rect): boolean {
  const isUnderFloor =
    rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= WORLD.w && rect.y + rect.h <= WORLD.h

  return weather.falling > 0 && !isUnderFloor
}

function isAnyIn(pool: readonly { readonly at: Point }[], rect: Rect): boolean {
  for (const entity of pool) {
    if (isInside(rect, entity.at)) {
      return true
    }
  }

  return false
}

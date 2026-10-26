import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { Point, Rect, SignalHeadId, SignalState, StreetView } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'
import { SIM_STEP_MS } from '@/web/scene/sim/loop'
import { createLot, type Lot, resetLot, stepLot } from '@/web/scene/sim/street/lot'
import { signalOf } from '@/web/scene/sim/street/signals'
import {
  createTraffic,
  resetTraffic,
  stepTraffic,
  type Traffic,
} from '@/web/scene/sim/street/traffic'
import { movingRectOf, visibleRect } from '@/web/scene/view'
import { isInside } from '@/web/scene/world/rooms'

const KEY_SEPARATOR = '|'
// While nothing on the street shows, it steps itself this often, out of sight, and wakes the loop
// only when something comes into view.
const ARRIVAL_CHECK_MS = 1_000
// The most steps one arrival check catches up; older time is dropped, never replayed.
const MAX_CATCH_UP_STEPS = 20
const SIGNAL_HEADS: readonly SignalHeadId[] = ['north', 'side', 'walk']
const NOBODY: readonly never[] = Object.freeze([])

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
}

interface StreetState {
  readonly deps: StreetDeps
  readonly traffic: Traffic
  readonly lot: Lot
  readonly view: StreetView & {
    step: number
    readonly signals: Record<SignalHeadId, SignalState>
  }
  stepMs: number
  lastStepAt: number
  isLotMoving: boolean
  isShowing: boolean
}

/** The street of the home region's pack; a day, region or zone change rebuilds it. Under reduced
 *  motion it stands still as the clock placed it. */
export function createStreet(deps: StreetDeps): Street {
  const traffic = createTraffic(deps.pack.peek())
  const lot = createLot()
  const state: StreetState = {
    deps,
    traffic,
    lot,
    view: createView(traffic, lot),
    stepMs: 0,
    lastStepAt: 0,
    isLotMoving: false,
    isShowing: false,
  }
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
    nextDueAt: () =>
      state.isShowing && !deps.reduced.peek()
        ? state.lastStepAt + SIM_STEP_MS
        : Number.POSITIVE_INFINITY,
    watchArrivals: (wake) => watchArrivals(state, wake),
    dispose: stopWatch,
  }
}

// The snapshot the painter reads: the pools' own arrays, filled in place by each step.
function createView(traffic: Traffic, lot: Lot): StreetState['view'] {
  return {
    step: 0,
    pools: { vehicles: traffic.shown, people: NOBODY, critters: NOBODY },
    signals: {
      north: signalOf('north', 0),
      side: signalOf('side', 0),
      walk: signalOf('walk', 0),
    },
    says: traffic.saying,
    lot: lot.view,
  }
}

function resumeStreet(state: StreetState): void {
  const nowMs = performance.now()
  const { day, minute } = pageMinute.peek()
  const pack = state.deps.pack.peek()

  resetTraffic(state.traffic, { pack, day, minute, nowMs })
  resetLot(state.lot, { pack, minute })
  syncSignals(state.view.signals, state.deps.reduced.peek() ? 0 : nowMs)
  state.lastStepAt = nowMs
  state.isShowing = false
  state.view.step++
}

function stepStreet(state: StreetState, nowMs: number): boolean {
  const startedAt = performance.now()

  state.isShowing = false

  if (!state.deps.reduced.peek()) {
    stepAll(state, nowMs)
    state.isShowing = isMovingInView(state, movingRectOf(visibleRect()))
  }

  if (state.isShowing) {
    state.view.step++
  }

  state.stepMs = performance.now() - startedAt

  return state.isShowing
}

function stepAll(state: StreetState, nowMs: number): void {
  const { traffic } = state
  const { minute } = pageMinute.peek()

  stepTraffic(traffic, { minute, nowMs })
  syncSignals(state.view.signals, nowMs)
  state.isLotMoving = stepLot(state.lot, { pack: traffic.pack, minute, nowMs, dt: traffic.tick.dt })
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

    catchUp(state, nowMs)

    if (isMovingInView(state, movingRectOf(visibleRect()))) {
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

// A vehicle in view, or the attendant walking there; parked bikes alone never keep it awake.
function isMovingInView(state: StreetState, rect: Rect): boolean {
  if (isAnyIn(state.traffic.shown, rect)) {
    return true
  }

  const { attendant } = state.lot.view

  return state.isLotMoving && attendant !== undefined && isInside(rect, attendant.at)
}

function syncSignals(signals: Record<SignalHeadId, SignalState>, nowMs: number): void {
  for (const head of SIGNAL_HEADS) {
    signals[head] = signalOf(head, nowMs)
  }
}

/** Something stands on the street within `rect`: a vehicle, a person, an animal, a parked
 *  motorbike or the lot's attendant. */
export function hasStreetEntities(view: StreetView, rect: Rect): boolean {
  const { pools, lot } = view

  if (
    isAnyIn(pools.vehicles, rect) ||
    isAnyIn(pools.people, rect) ||
    isAnyIn(pools.critters, rect)
  ) {
    return true
  }

  for (let index = 0; index < lot.parked; index++) {
    const slot = lot.slots[index]

    if (slot !== undefined && isInside(rect, slot)) {
      return true
    }
  }

  return lot.attendant !== undefined && isInside(rect, lot.attendant.at)
}

function isAnyIn(pool: readonly { readonly at: Point }[], rect: Rect): boolean {
  for (const entity of pool) {
    if (isInside(rect, entity.at)) {
      return true
    }
  }

  return false
}

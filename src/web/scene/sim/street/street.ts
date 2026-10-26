import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { SignalHeadId, SignalState, StreetView } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'
import { createLot, type Lot, resetLot, stepLot } from '@/web/scene/sim/street/lot'
import { signalOf } from '@/web/scene/sim/street/signals'
import {
  createTraffic,
  resetTraffic,
  stepTraffic,
  type Traffic,
} from '@/web/scene/sim/street/traffic'

const KEY_SEPARATOR = '|'
// While the street stands empty, it looks for new traffic this often.
const EMPTY_CHECK_MS = 1_000
const SIGNAL_HEADS: readonly SignalHeadId[] = ['north', 'side', 'walk']
const NOBODY: readonly never[] = Object.freeze([])

/** The one street both renderers show: its pools, stepped with the office; `stepMs` is the last
 *  step's time. */
export interface Street {
  /** Advances the street one sim step; true while something on it moved. */
  step(nowMs: number): boolean
  view(): StreetView
  /** Rebuilds the pools from the clock and the keyed seeds, never replaying missed steps. */
  resume(): void
  stepMs(): number
  /** The next scheduled change, a `performance.now()` instant; `Infinity` while none is due. */
  nextDueAt(nowMs: number): number
  dispose(): void
}

/** The street of the home region's pack; a day, region or zone change rebuilds it. Under reduced
 *  motion it stands still as the clock placed it. */
export function createStreet(deps: {
  readonly pack: ReadonlySignal<RegionPack>
  readonly reduced: ReadonlySignal<boolean>
}): Street {
  const traffic = createTraffic(deps.pack.peek())
  const lot = createLot()
  const view = createView(traffic, lot)
  const { signals } = view
  let stepMs = 0
  let placeKey = ''
  // Nothing to look for: the street stands still, or traffic already steps the loop.
  const isIdle = (): boolean => deps.reduced.peek() || traffic.shown.length > 0

  const resume = (): void => {
    const nowMs = performance.now()
    const { day, minute } = pageMinute.peek()
    const pack = deps.pack.peek()

    resetTraffic(traffic, { pack, day, minute, nowMs })
    resetLot(lot, { pack, minute })
    syncSignals(signals, deps.reduced.peek() ? 0 : nowMs)
    view.step++
  }
  const stopWatch = effect(() => {
    const key = [deps.pack.value.id, pageMinute.value.day, sceneZone.value].join(KEY_SEPARATOR)

    if (key !== placeKey) {
      placeKey = key
      untracked(resume)
    }
  })

  return {
    step(nowMs) {
      const startedAt = performance.now()
      const isMoving = !deps.reduced.peek() && stepAll({ traffic, lot, signals, nowMs })

      if (isMoving) {
        view.step++
      }

      stepMs = performance.now() - startedAt

      return isMoving
    },
    view: () => view,
    resume,
    stepMs: () => stepMs,
    nextDueAt: (nowMs) => (isIdle() ? Number.POSITIVE_INFINITY : nowMs + EMPTY_CHECK_MS),
    dispose: stopWatch,
  }
}

// The snapshot the painter reads: the pools' own arrays, filled in place by each step.
function createView(
  traffic: Traffic,
  lot: Lot
): StreetView & { step: number; readonly signals: Record<SignalHeadId, SignalState> } {
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

function stepAll(at: {
  readonly traffic: Traffic
  readonly lot: Lot
  readonly signals: Record<SignalHeadId, SignalState>
  readonly nowMs: number
}): boolean {
  const { traffic, nowMs } = at
  const { minute } = pageMinute.peek()

  stepTraffic(traffic, { minute, nowMs })
  syncSignals(at.signals, nowMs)

  const isLotMoving = stepLot(at.lot, { pack: traffic.pack, minute, nowMs, dt: traffic.tick.dt })

  return traffic.shown.length > 0 || isLotMoving
}

function syncSignals(signals: Record<SignalHeadId, SignalState>, nowMs: number): void {
  for (const head of SIGNAL_HEADS) {
    signals[head] = signalOf(head, nowMs)
  }
}

/** Something stands on the street: a vehicle, a person, an animal, a parked motorbike or the lot's
 *  attendant. */
export function hasStreetEntities(view: StreetView): boolean {
  const { pools, lot } = view

  return (
    pools.vehicles.length > 0 ||
    pools.people.length > 0 ||
    pools.critters.length > 0 ||
    lot.parked > 0 ||
    lot.attendant !== undefined
  )
}

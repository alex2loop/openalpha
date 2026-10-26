import { effect, type ReadonlySignal, untracked } from '@preact/signals'

import type { StreetView } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import { pageMinute, sceneZone } from '@/web/scene/clock/clock'

const KEY_SEPARATOR = '|'

type Pools = StreetView['pools']

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
 *  motion nothing on it moves. */
export function createStreet(deps: {
  readonly pack: ReadonlySignal<RegionPack>
  readonly reduced: ReadonlySignal<boolean>
}): Street {
  let pools = emptyPools()
  let step = 0
  let stepMs = 0
  let placeKey = ''

  const resume = (): void => {
    pools = emptyPools()
    step++
  }
  const stopWatch = effect(() => {
    const key = [deps.pack.value.id, pageMinute.value.day, sceneZone.value].join(KEY_SEPARATOR)

    if (key !== placeKey) {
      placeKey = key
      untracked(resume)
    }
  })

  return {
    step() {
      const startedAt = performance.now()
      const isMoving = !deps.reduced.value && hasStreetEntities(pools)

      if (isMoving) {
        step++
      }

      stepMs = performance.now() - startedAt

      return isMoving
    },
    view: () => ({ step, pools }),
    resume,
    stepMs: () => stepMs,
    nextDueAt: () => Number.POSITIVE_INFINITY,
    dispose: stopWatch,
  }
}

function emptyPools(): Pools {
  return { vehicles: [], people: [], critters: [] }
}

/** Something stands in one of the pools. */
export function hasStreetEntities(held: Pools): boolean {
  return Object.values(held).some((pool) => pool.length > 0)
}

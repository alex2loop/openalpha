import type { Ped } from '@/web/scene/sim/street/ped-walk'
import type { Traffic } from '@/web/scene/sim/street/traffic'
import type { PersonView, VehicleView } from '@/web/scene/street-types'
import type { Rect } from '@/web/scene/types'
import type { RegionPack } from '@/web/scene/world/regions'
import {
  type Critters,
  createCritters,
  isCritterMovingIn,
  resetCritters,
  stepCritters,
} from '@/web/scene/sim/street/critters'
import { createParks, type Parks, resetParks, stepParks } from '@/web/scene/sim/street/park'
import {
  createVendors,
  isVendorMovingIn,
  resetVendors,
  stepVendors,
  type Vendors,
} from '@/web/scene/sim/street/vendors'

/** The street's life beside its traffic: the parks, the pavement vendors and the animals, their
 *  pools of people (merged with the street's own each step), and the clock they step on. */
export interface StreetLife {
  readonly parks: Parks
  readonly vendors: Vendors
  readonly critters: Critters
  readonly crowds: readonly (readonly Ped[])[]
  readonly clock: LifeClock
}

/** A life step's pack and clock, and the people and vehicles the animals mind; refilled in place. */
interface LifeClock {
  pack: RegionPack
  minute: number
  nowMs: number
  dt: number
  readonly people: readonly PersonView[]
  readonly vehicles: readonly VehicleView[]
}

/** The life of `traffic`'s street; the animals mind `people`, the street's merged list. */
export function createStreetLife(traffic: Traffic, people: readonly PersonView[]): StreetLife {
  const parks = createParks()
  const vendors = createVendors()
  const critters = createCritters()

  return {
    parks,
    vendors,
    critters,
    crowds: [parks.pool, vendors.pool, critters.walkers],
    clock: { pack: traffic.pack, minute: 0, nowMs: 0, dt: 0, people, vehicles: traffic.shown },
  }
}

/** Rebuilds the parks, vendors and animals from the clock. */
export function resetStreetLife(
  life: StreetLife,
  at: {
    readonly pack: RegionPack
    readonly day: string
    readonly minute: number
    readonly nowMs: number
  }
): void {
  resetParks(life.parks, at)
  resetVendors(life.vendors, at)
  resetCritters(life.critters, at)
}

/** One sim step on the traffic's clock, just stepped; the animals see where everyone stood after
 *  the last step. */
export function stepStreetLife(life: StreetLife, traffic: Traffic): void {
  const { clock } = life

  clock.pack = traffic.pack
  clock.minute = traffic.tick.minute
  clock.nowMs = traffic.tick.nowMs
  clock.dt = traffic.tick.dt
  stepParks(life.parks, clock)
  stepVendors(life.vendors, clock)
  stepCritters(life.critters, clock)
}

/** An animal or the flower bicycle moves within `rect`, or steam rises from a pot there. */
export function isLifeMovingIn(life: StreetLife, rect: Rect): boolean {
  return isCritterMovingIn(life.critters, rect) || isVendorMovingIn(life.vendors, rect)
}

import type { Park } from '@/web/scene/sim/street/park-layout'
import type { createRng } from '@/web/scene/world/rng'
import { PARKS } from '@/web/scene/sim/street/park-layout'
import {
  addPoint,
  clearRoute,
  createPed,
  PAVEMENT,
  type Ped,
  SIDE_WALKS,
  WALK_REACH_PX,
} from '@/web/scene/sim/street/ped-walk'
import { type Point, WORLD } from '@/web/scene/types'
import { STREET_BOTTOM } from '@/web/scene/view'
import { sideX } from '@/web/scene/world/street-layout'

/** What someone does in a park. */
export const PARK_ROLES = ['stroll', 'jog', 'sit', 'train', 'kid'] as const
export type ParkRole = (typeof PARK_ROLES)[number]
const PARK_ROUTE_MAX = 64
// A side park's gates north of this come in from the side street's north end, the rest from its
// south end; north park people come along the far pavement, more often from its west end.
const SIDE_ENTRY_SPLIT_Y = 300
const WEST_END_SHARE = 0.6
// Where south park people come along the plaza from: the side pavements on both sides.
const PLAZA_ENDS = [
  sideX(-1, SIDE_WALKS.far),
  sideX(-1, SIDE_WALKS.near),
  sideX(1, SIDE_WALKS.near),
  sideX(1, SIDE_WALKS.far),
] as const

export type Rng = ReturnType<typeof createRng>

/** Someone in a park, written only by the street sim: their park and role, the bench or spot they
 *  took, the path node they leave from, and whether they are going in, staying or leaving. */
export interface ParkPed extends Ped {
  park: Park
  role: ParkRole
  seat: number
  node: number
  stage: 'go' | 'stay' | 'leave'
  until: number
}

/** A park walker with a route long enough for a jog loop. */
export function createParkPed(): ParkPed {
  return {
    ...createPed(),
    route: Array.from({ length: PARK_ROUTE_MAX }, () => ({ x: 0, y: 0 })),
    park: PARKS[0],
    role: 'stroll',
    seat: -1,
    node: 0,
    stage: 'go',
    until: 0,
  }
}

/** A fresh route from the street to one of the park's gates (from the gate itself when the clock
 *  places them inside); the gate's node. */
export function enterRoute(
  rng: Rng,
  ped: ParkPed,
  at: { readonly park: Park; readonly isPlaced: boolean }
): number {
  const gate = nodeOf(rng, at.park.gates)
  const point = at.park.nodes[gate]

  clearRoute(ped)

  if (!at.isPlaced) {
    addStreetLeg(rng, ped, { gate, isOut: false })
  }

  if (point !== undefined) {
    addPoint(ped, point.x, point.y)
  }

  return gate
}

/** A fresh route from the node they stand by, along the paths to a gate and out to the street. */
export function leaveRoute(rng: Rng, ped: ParkPed): void {
  const exit = nodeOf(rng, ped.park.gates)
  const from = ped.park.nodes[ped.node]

  clearRoute(ped)

  if (from !== undefined) {
    addPoint(ped, from.x, from.y)
  }

  addPath(ped, { from: ped.node, to: exit })
  addStreetLeg(rng, ped, { gate: exit, isOut: true })
}

/** The two street points before a gate (after it, going out). */
export function addStreetLeg(
  rng: Rng,
  ped: ParkPed,
  leg: { readonly gate: number; readonly isOut: boolean }
): void {
  const gate = ped.park.nodes[leg.gate]

  if (gate === undefined) {
    return
  }

  const { from, near } = streetEndsOf(rng, ped.park, gate)

  if (leg.isOut) {
    addPoint(ped, near.x, near.y)
    addPoint(ped, from.x, from.y)
  } else {
    addPoint(ped, from.x, from.y)
    addPoint(ped, near.x, near.y)
  }
}

// Along the far pavement to the north park, the side street's far pavement to a side park, the
// plaza to the south park: where they come from, and the point before the gate.
function streetEndsOf(
  rng: Rng,
  park: Park,
  gate: Point
): { readonly from: Point; readonly near: Point } {
  if (park.id === 'north') {
    const x = gate.x < 0 || rng.next() < WEST_END_SHARE ? -WALK_REACH_PX : WORLD.w + WALK_REACH_PX

    return { from: { x, y: PAVEMENT.far }, near: { x: gate.x, y: PAVEMENT.far } }
  }

  if (park.side !== 0) {
    const x = sideX(park.side, SIDE_WALKS.far)
    const y = gate.y < SIDE_ENTRY_SPLIT_Y ? PAVEMENT.sideTop : STREET_BOTTOM

    return { from: { x, y }, near: { x, y: gate.y } }
  }

  return {
    from: { x: rng.pick(PLAZA_ENDS), y: PAVEMENT.south },
    near: { x: gate.x, y: PAVEMENT.south },
  }
}

/** Adds the nodes after `from` on the shortest path to `to` in their park; the node it ends on. */
export function addPath(
  ped: ParkPed,
  path: { readonly from: number; readonly to: number }
): number {
  const { park } = ped
  const count = park.nodes.length
  let node = path.from

  while (node !== path.to) {
    const next = park.hops[node * count + path.to] ?? -1
    const at = park.nodes[next]

    if (at === undefined || next === node) {
      break
    }

    addPoint(ped, at.x, at.y)
    node = next
  }

  ped.node = node

  return node
}

/** Places them somewhere along their route, as the clock finds them mid-walk. */
export function placeAlong(rng: Rng, ped: ParkPed, nowMs: number): void {
  const leg = rng.int(1, Math.max(1, ped.routeLength - 1))
  const a = ped.route[leg - 1]
  const b = ped.route[leg]
  const share = rng.next()

  if (a === undefined || b === undefined) {
    return
  }

  placeAt(ped, { x: a.x + (b.x - a.x) * share, y: a.y + (b.y - a.y) * share })
  ped.leg = leg
  ped.movedAt = nowMs
}

export function placeAt(ped: ParkPed, at: { readonly x: number; readonly y: number }): void {
  ped.at.x = at.x
  ped.at.y = at.y
  ped.prev.x = at.x
  ped.prev.y = at.y
}

/** One of `nodes`, by chance. */
export function nodeOf(rng: Rng, nodes: readonly number[]): number {
  return nodes[rng.int(0, nodes.length - 1)] ?? 0
}

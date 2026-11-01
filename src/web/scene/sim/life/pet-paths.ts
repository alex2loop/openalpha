import type { FloorId, PetKind, Point } from '@/web/scene/types'

/** The pets live in the lobby, on the office floor, and never leave it. */
export const PET_FLOOR: FloorId = 'office'
// A pet keeps this far from anyone on the line it walks.
const PATH_CLEAR_PX = 9

export type NodeId = keyof typeof NODES

/** Where a pet stands: its feet on the floor and how far above it (a perch). */
export interface Spot {
  readonly x: number
  readonly y: number
  readonly lift: number
}

/** A place to jump up to: its top, the nodes it is reached from, and how near a person comes
 *  before the pet leaves it. */
export interface Perch {
  readonly spot: Spot
  readonly from: readonly [NodeId, ...NodeId[]]
  readonly clearPx: number
  readonly who: readonly PetKind[]
}

// The lobby's floor graph: an edge is a straight walk clear of the furniture.
export const NODES = Object.freeze({
  mat: { x: 153, y: 284, lift: 0 },
  pass: { x: 154, y: 304, lift: 0 },
  pocketE: { x: 141, y: 306.5, lift: 0 },
  pocketN: { x: 121, y: 314, lift: 0 },
  bed: { x: 148, y: 325, lift: 0 },
  bedW: { x: 137, y: 327, lift: 0 },
  south: { x: 141, y: 340, lift: 0 },
  pocketS: { x: 121, y: 341, lift: 0 },
  east: { x: 153, y: 338, lift: 0 },
  east2: { x: 153, y: 356, lift: 0 },
  e3: { x: 153, y: 372, lift: 0 },
  home: { x: 140, y: 371, lift: 0 },
  w1: { x: 127, y: 360, lift: 0 },
  s1: { x: 127, y: 380, lift: 0 },
  s2: { x: 100, y: 380, lift: 0 },
  s3: { x: 76, y: 380, lift: 0 },
  s4: { x: 44, y: 380, lift: 0 },
  s5: { x: 14, y: 380, lift: 0 },
} satisfies Record<string, Spot>)
const EDGES: readonly (readonly [NodeId, NodeId])[] = Object.freeze([
  ['mat', 'pass'],
  ['pass', 'pocketE'],
  ['pocketE', 'pocketN'],
  ['pocketE', 'bedW'],
  ['bedW', 'bed'],
  ['bedW', 'south'],
  ['bed', 'south'],
  ['south', 'east'],
  ['south', 'pocketS'],
  ['pocketS', 'w1'],
  ['w1', 's1'],
  ['east', 'east2'],
  ['east2', 'e3'],
  ['e3', 'home'],
  ['home', 's1'],
  ['s1', 's2'],
  ['s2', 's3'],
  ['s3', 's4'],
  ['s4', 's5'],
])
export const PERCHES: readonly Perch[] = Object.freeze([
  { spot: { x: 44, y: 363, lift: 10 }, from: ['s4'], clearPx: 16, who: ['cat', 'corgi'] },
  { spot: { x: 76, y: 363, lift: 10 }, from: ['s3'], clearPx: 16, who: ['cat', 'corgi'] },
  { spot: { x: 124, y: 328, lift: 13 }, from: ['pocketN', 'pocketS'], clearPx: 14, who: ['cat'] },
])
const ADJACENT: ReadonlyMap<NodeId, readonly NodeId[]> = toAdjacency(EDGES)
export const NODE_IDS = Object.keys(NODES).filter(isNodeId)
/** The nodes from `from` to `to` along the graph, `from` left out; `undefined` when none joins
 *  them. */
export function routeOf(from: NodeId, to: NodeId): readonly NodeId[] | undefined {
  const prev = new Map<NodeId, NodeId | undefined>([[from, undefined]])
  const queue: NodeId[] = [from]

  for (let i = 0; i < queue.length && !prev.has(to); i++) {
    const at = queue[i]

    for (const next of at === undefined ? [] : (ADJACENT.get(at) ?? [])) {
      if (!prev.has(next)) {
        prev.set(next, at)
        queue.push(next)
      }
    }
  }

  if (!prev.has(to)) {
    return undefined
  }

  const route: NodeId[] = []

  for (let at: NodeId | undefined = to; at !== undefined; at = prev.get(at)) {
    route.unshift(at)
  }

  return route.slice(1)
}

export function isPersonNear(people: readonly Point[], at: Point, px: number): boolean {
  return people.some((person) => Math.hypot(person.x - at.x, person.y - at.y) < px)
}

export function isPersonOnLine(people: readonly Point[], a: Point, b: Point): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSq = dx * dx + dy * dy || 1

  return people.some((person) => {
    const t = Math.max(0, Math.min(1, ((person.x - a.x) * dx + (person.y - a.y) * dy) / lengthSq))

    return Math.hypot(person.x - a.x - dx * t, person.y - a.y - dy * t) < PATH_CLEAR_PX
  })
}

function toAdjacency(
  edges: readonly (readonly [NodeId, NodeId])[]
): ReadonlyMap<NodeId, readonly NodeId[]> {
  const adjacent = new Map<NodeId, NodeId[]>()

  for (const [a, b] of edges) {
    adjacent.set(a, [...(adjacent.get(a) ?? []), b])
    adjacent.set(b, [...(adjacent.get(b) ?? []), a])
  }

  return adjacent
}

function isNodeId(id: string): id is NodeId {
  return Object.hasOwn(NODES, id)
}

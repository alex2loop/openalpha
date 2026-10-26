import type { Lift } from '@/web/scene/sim/lift'
import type { Person } from '@/web/scene/sim/people'
import type { ActorId, Dir, Point } from '@/web/scene/types'
import { distance, toFreePoint } from '@/web/scene/sim/actors/nav'
import { isWalking, placeWalker } from '@/web/scene/sim/actors/walk'
import { otherFloorOf } from '@/web/scene/world/floors'
import { NAV_CELL_PX, NAV_CLEARANCE_PX, navGridOf } from '@/web/scene/world/nav-grid'
import { isPropKind, type PropDef, type PropKind, propsOn } from '@/web/scene/world/props'
import { roomById, WALL_BAND_PX } from '@/web/scene/world/rooms'
import { LIFT_EXITS } from '@/web/scene/world/seats'

// A prop spot is taken when someone's goal puts them this close to it; the next waits further.
const CLAIM_PX = NAV_CELL_PX * 2
const WAIT_GAP_PX = 8
// Within this of the lift door a person waits for the car; a second rider stands a step aside.
const LANDING_PX = 14

/** Where a person's goal puts them: their floor's lift door while it lies on another floor, a
 *  place, the nearest free prop of a kind, else their seat. */
export function destOf(person: Person, people: readonly Person[]): Point {
  const target = person.goal?.target

  if (isBoundForLift(person)) {
    return LIFT_EXITS[person.floor]
  }

  if (target === undefined) {
    return person.def.seat.at
  }

  if (typeof target !== 'string') {
    return toFreePoint(navGridOf(person.floor), target)
  }

  return isPropKind(target) ? propSpotOf(person, { people, kind: target }) : person.def.seat.at
}

/** A goal on another floor: at their lift door the person calls the car and waits, the call lit;
 *  they board once it stands open there, and step out at the other floor's door once it opens
 *  there (`landed`: they walk on from it). */
export function takeLift(person: Person, lift: Lift): 'boarded' | 'landed' | undefined {
  const exit = otherFloorOf(person.floor)

  if (person.isRiding) {
    if (!lift.isOpenOn(exit)) {
      lift.call(exit)
      return undefined
    }

    person.isRiding = false
    person.floor = exit
    placeWalker(person.walker, LIFT_EXITS[exit])

    return 'landed'
  }

  if (!(isBoundForLift(person) && isAtLanding(person))) {
    return undefined
  }

  if (!lift.isOpenOn(person.floor)) {
    lift.call(person.floor)
    return undefined
  }

  person.isRiding = true
  lift.call(exit)

  return 'boarded'
}

/** The person's goal lies on another floor than the one they stand on, and they are not in the
 *  car yet. */
export function isBoundForLift(person: Person): boolean {
  return !person.isRiding && (person.goal?.floor ?? person.def.floor) !== person.floor
}

function isAtLanding(person: Person): boolean {
  return (
    !isWalking(person.walker) && distance(person.walker.pos, LIFT_EXITS[person.floor]) <= LANDING_PX
  )
}

/** The way a person looks: where they walk, else at whoever their goal faces, else their seat's
 *  way, else at what they came to (props are approached from the south). */
export function facingOf(person: Person, byId: ReadonlyMap<ActorId, Person>): Dir {
  const { pos, prev } = person.walker

  if (pos.x !== prev.x || pos.y !== prev.y) {
    return toDir(pos.x - prev.x, pos.y - prev.y)
  }

  const face = person.goal?.face === undefined ? undefined : byId.get(person.goal.face)

  if (face !== undefined) {
    return toDir(face.walker.pos.x - pos.x, face.walker.pos.y - pos.y)
  }

  const look = person.goal?.look

  if (look !== undefined) {
    return toDir(look.x - pos.x, look.y - pos.y)
  }

  return person.dest === person.def.seat.at ? person.def.seat.face : 'up'
}

// Nearest the person's seat first; a spot someone else's goal holds is taken, and when every one
// is, the person waits one step behind the nearest.
function propSpotOf(
  person: Person,
  want: { readonly people: readonly Person[]; readonly kind: PropKind }
): Point {
  const seat = person.def.seat.at
  const grid = navGridOf(person.floor)
  const spots = propsOn(person.floor)
    .filter((prop) => prop.kind === want.kind)
    .map((prop) => toFreePoint(grid, approachOf(prop)))
    .sort((a, b) => distance(a, seat) - distance(b, seat))
  const isTaken = (spot: Point): boolean =>
    want.people.some((other) => other !== person && distance(other.dest, spot) < CLAIM_PX)
  const nearest = spots[0]

  if (nearest === undefined) {
    return seat
  }

  return (
    spots.find((spot) => !isTaken(spot)) ??
    toFreePoint(grid, { x: nearest.x, y: nearest.y + WAIT_GAP_PX })
  )
}

/** One step south of the prop's footprint, clear of the wall band for a piece hung on the wall. */
export function approachOf(prop: PropDef): Point {
  const room = roomById(prop.room)
  const floorTop = room === undefined ? 0 : room.rect.y + WALL_BAND_PX
  const bottom = Math.max(prop.rect.y + prop.rect.h, floorTop)

  return { x: prop.rect.x + prop.rect.w / 2, y: bottom + NAV_CLEARANCE_PX + NAV_CELL_PX }
}

/** The way a step of `dx`, `dy` faces. */
export function toDir(dx: number, dy: number): Dir {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? 'left' : 'right'
  }

  return dy < 0 ? 'up' : 'down'
}

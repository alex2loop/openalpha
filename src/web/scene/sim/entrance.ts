import type { People } from '@/web/scene/sim/people'
import type { ActorId } from '@/web/scene/types'
import { placeWalker, startWalk } from '@/web/scene/sim/actors/walk'
import { destOf } from '@/web/scene/sim/places'
import { STREET_DOOR } from '@/web/scene/world/doors'
import { navGridOf } from '@/web/scene/world/nav-grid'

/** Back through the street door: the person walks from the door to where their goal puts them,
 *  or stands there at once (`isInstant`, or when no walk reaches it). */
export function enterPerson(
  people: People,
  at: { readonly id: ActorId; readonly isInstant: boolean }
): void {
  const person = people.byId.get(at.id)

  if (person === undefined) {
    return
  }

  person.floor = person.def.floor
  person.dest = destOf(person, people.list)
  placeWalker(person.walker, STREET_DOOR)

  const grid = navGridOf(person.floor, people.obstacles.get(person.floor))
  const isStarted = !at.isInstant && startWalk(person.walker, grid, person.dest)

  if (!isStarted) {
    placeWalker(person.walker, person.dest)
  }

  person.phase = isStarted ? 'walking' : 'still'
}

import type { SceneRenderer } from '@/web/scene/renderer'
import type {
  ActorView,
  FloorId,
  PetView,
  Point,
  Rect,
  ScreenPoint,
  SimView,
} from '@/web/scene/types'
import { overlayView } from '@/web/scene/overlay/overlay'
import { PET_FLOOR } from '@/web/scene/sim/life/pet-paths'
import { FIGURE } from '@/web/scene/types'
import { type PropDef, propsOn } from '@/web/scene/world/props'
import { isInside, roomAt } from '@/web/scene/world/rooms'

/** What a point on the scene is over, front to back. `id` is an actor id for a marker, an actor,
 *  a screen and a tag, a prop id for an object, a room id for a room. */
export interface Hit {
  readonly kind: 'marker' | 'actor' | 'pet' | 'screen' | 'object' | 'tag' | 'room'
  readonly id: string
}

// A pet's box over its feet, in world px.
const PET_BOX = Object.freeze({ w: 16, h: 14 })

/** The front-most thing under `point` (CSS px of the scene host): a marker, a person, a lit
 *  screen, a prop, a name tag, then a room. */
export function pickAt(
  point: ScreenPoint,
  renderer: SceneRenderer,
  view: SimView
): Hit | undefined {
  const shown = overlayView.value
  const at = renderer.toWorld(point)
  const marker = shown.markers.find((held) => isInside(held.rect, point))

  if (marker !== undefined) {
    return { kind: 'marker', id: marker.marker.actor }
  }

  const actor = actorAt(view, at)

  if (actor !== undefined) {
    return { kind: 'actor', id: actor.id }
  }

  const pet =
    view.floor === PET_FLOOR
      ? view.life.pets.find((each) => isInside(petBoxOf(each), at))
      : undefined

  if (pet !== undefined) {
    return { kind: 'pet', id: pet.kind }
  }

  const screen = shown.screens.find((held) => isInside(held.rect, point))

  if (screen !== undefined) {
    return { kind: 'screen', id: screen.screen.actor }
  }

  const prop = propAt(view.floor, at)

  if (prop !== undefined) {
    return { kind: 'object', id: prop.id }
  }

  const tag = shown.tags.find((held) => isInside(held.rect, point))

  if (tag !== undefined) {
    return { kind: 'tag', id: tag.actor }
  }

  const room = roomAt(view.floor, at)

  return room === undefined ? undefined : { kind: 'room', id: room.id }
}

/** The front-most prop under the point: the one standing lowest on the floor. */
function propAt(floor: FloorId, at: Point): PropDef | undefined {
  return propsOn(floor)
    .filter((prop) => isInside(prop.draw, at))
    .sort((a, b) => b.sortY - a.sortY)[0]
}

/** A person's figure where the frame draws it, in world px. */
export function figureOf(actor: ActorView, alpha: number): Rect {
  const x = actor.prev.x + (actor.at.x - actor.prev.x) * alpha
  const y = actor.prev.y + (actor.at.y - actor.prev.y) * alpha

  return { x: x - FIGURE.w / 2, y: y - FIGURE.h, w: FIGURE.w, h: FIGURE.h }
}

function petBoxOf(pet: PetView): Rect {
  return {
    x: pet.at.x - PET_BOX.w / 2,
    y: pet.at.y - pet.lift - PET_BOX.h,
    w: PET_BOX.w,
    h: PET_BOX.h,
  }
}

// The front-most person on the floor shown: the one standing lowest.
function actorAt(view: SimView, at: Point): ActorView | undefined {
  return view.actors
    .filter((actor) => actor.floor === view.floor && isInside(figureOf(actor, view.alpha), at))
    .sort((a, b) => b.at.y - a.at.y)[0]
}

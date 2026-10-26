import type { MovingScene, PaintPart } from '@/web/scene/render2d/street/paint'
import type { StreetView } from '@/web/scene/street-types'
import type { Point } from '@/web/scene/types'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { drawCritter } from '@/web/scene/render2d/street/critters'
import { drawFlowerBike } from '@/web/scene/render2d/street/flower-bike'
import { drawPerson } from '@/web/scene/render2d/street/people'
import { drawVehicle, paintLot, paintSays } from '@/web/scene/render2d/street/vehicles'
import { isInside } from '@/web/scene/world/rooms'

const NOWHERE = Number.POSITIVE_INFINITY

/** Everything that moves on the street, in depth order: the parked lot first, then vehicles,
 *  people, animals and the flower bicycle merged north to south (each list already is), then the
 *  words said over them all. */
export const MOVERS_PART: PaintPart = {
  paintStatic: () => undefined,
  paintMoving: (g, view, scene) => {
    paintLot(g, view, scene)
    paintInDepth(g, view, scene)
    paintSays(g, view, scene)
  },
}

// One cursor per list; the next drawn is the northmost, a vehicle first on a tie, then a person,
// an animal, the bicycle; done once every list is.
function paintInDepth(g: CanvasRenderingContext2D, view: StreetView, scene: MovingScene): void {
  const pass: Pass = {
    view,
    scene,
    dark: darknessOf(scene.minute.minute),
    v: 0,
    p: 0,
    c: 0,
    bikeY: yOf(view.vendors.bike),
  }

  let isMore = true

  while (isMore) {
    isMore = drawNext(g, pass)
  }
}

/** One depth pass over a frame: where each list's cursor stands, and the bicycle's y until it is
 *  drawn. */
interface Pass {
  readonly view: StreetView
  readonly scene: MovingScene
  readonly dark: number
  v: number
  p: number
  c: number
  bikeY: number
}

// Draws the next one north to south (when inside the moving rect); false once all are drawn.
function drawNext(g: CanvasRenderingContext2D, pass: Pass): boolean {
  const { view, scene } = pass
  const vehicle = view.pools.vehicles[pass.v]
  const person = view.pools.people[pass.p]
  const critter = view.pools.critters[pass.c]
  const { bike } = view.vendors

  switch (nextOf(pass)) {
    case 'vehicle':
      pass.v++

      if (vehicle !== undefined && isInside(scene.rect, vehicle.at)) {
        drawVehicle(g, vehicle, { scene, dark: pass.dark })
      }

      return true
    case 'person':
      pass.p++

      if (person !== undefined && isInside(scene.rect, person.at)) {
        drawPerson(g, person, scene)
      }

      return true
    case 'critter':
      pass.c++

      if (critter !== undefined && isInside(scene.rect, critter.at)) {
        drawCritter(g, critter, scene)
      }

      return true
    case 'bike':
      pass.bikeY = NOWHERE

      if (bike !== undefined && isInside(scene.rect, bike.at)) {
        drawFlowerBike(g, bike, scene)
      }

      return true
    default:
      return false
  }
}

function nextOf(pass: Pass): 'vehicle' | 'person' | 'critter' | 'bike' | undefined {
  const { pools } = pass.view
  const vy = yOf(pools.vehicles[pass.v])
  const py = yOf(pools.people[pass.p])
  const cy = yOf(pools.critters[pass.c])
  const next = Math.min(vy, py, cy, pass.bikeY)

  if (next === NOWHERE || Number.isNaN(next)) {
    return undefined
  }

  if (vy === next) {
    return 'vehicle'
  }

  if (py === next) {
    return 'person'
  }

  return cy === next ? 'critter' : 'bike'
}

function yOf(item: { readonly at: Point } | undefined): number {
  return item === undefined ? NOWHERE : item.at.y
}

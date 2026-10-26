import type { PaintPart } from '@/web/scene/render2d/street/paint'
import { darknessOf } from '@/web/scene/render2d/street/city'
import { drawPerson } from '@/web/scene/render2d/street/people'
import { drawVehicle, paintLot, paintSays } from '@/web/scene/render2d/street/vehicles'
import { isInside } from '@/web/scene/world/rooms'

/** Everything that moves on the street, in depth order: the parked lot first, then vehicles and
 *  people merged north to south (both lists already are), then the words said over them all. */
export const MOVERS_PART: PaintPart = {
  paintStatic: () => undefined,
  paintMoving: (g, view, scene) => {
    const { vehicles, people } = view.pools
    const dark = darknessOf(scene.minute.minute)
    let v = 0
    let p = 0

    paintLot(g, view, scene)

    while (v < vehicles.length || p < people.length) {
      const vehicle = vehicles[v]
      const person = people[p]

      if (person !== undefined && (vehicle === undefined || person.at.y < vehicle.at.y)) {
        p++

        if (isInside(scene.rect, person.at)) {
          drawPerson(g, person, scene)
        }
      } else if (vehicle !== undefined) {
        v++

        if (isInside(scene.rect, vehicle.at)) {
          drawVehicle(g, vehicle, { scene, dark })
        }
      }
    }

    paintSays(g, view, scene)
  },
}

import type { FloorProps } from '@/web/scene/render3d/props'
import type { SimView } from '@/web/scene/types'
import { roomAt } from '@/web/scene/world/rooms'

type Screen = FloorProps['screens'][number]

/** Where a laid-flat monitor's face and back lie: centres and the turn that lays them down. */
interface FlatPose {
  readonly face: readonly [x: number, y: number, z: number]
  readonly back: readonly [x: number, y: number, z: number]
  readonly tilt: number
}

// Someone standing still this close to a screen's seat sits at it, as 2D's reach.
const SEAT_REACH_PX = 12
// Your desk keeps its screens standing, as the mockup draws it.
const STANDING_ROOM = 'desk'
// Laid flat, the glass lies on the desk top this far towards the sitter from the stand.
const FLAT = Object.freeze({ toward: 6, rise: 0.6, backDrop: 0.4 })
const FLAT_TILT = -Math.PI / 2

/** Which of the floor's screens lie flat: a monitor at a desk someone sits still at, as the mockup
 *  lays it so the screen never prints on the sitter. */
export function seatedScreensOf(sim: SimView, props: FloorProps | undefined): readonly boolean[] {
  const still = sim.actors.filter(
    (actor) =>
      actor.floor === sim.floor &&
      actor.isAway !== true &&
      actor.isRiding !== true &&
      actor.prev.x === actor.at.x &&
      actor.prev.y === actor.at.y
  )

  return (props?.screens ?? []).map(
    (screen) =>
      roomAt(sim.floor, screen.seat)?.id !== STANDING_ROOM &&
      still.some(
        (actor) =>
          Math.hypot(actor.at.x - screen.seat.x, actor.at.y - screen.seat.y) <= SEAT_REACH_PX
      )
  )
}

/** A screen laid flat on its desk top, its glass up, towards its sitter. */
export function flatPoseOf(screen: Screen, deskTop: number): FlatPose {
  const [x, , z] = screen.at
  const centreZ = z + FLAT.toward

  return {
    face: [x, deskTop + FLAT.rise, centreZ],
    back: [x, deskTop + FLAT.rise - FLAT.backDrop, centreZ],
    tilt: FLAT_TILT,
  }
}

import type { CityScene } from '@/web/scene/render2d/street/city-blocks'
import type { PaintPart } from '@/web/scene/render2d/street/paint'
import type { RegionPack } from '@/web/scene/world/regions'
import { citySceneOf } from '@/web/scene/render2d/street/city'
import { paintLamp, paintTree } from '@/web/scene/render2d/street/city-blocks'
import {
  paintBench,
  paintFountain,
  paintHedgeRail,
  paintPaths,
  paintPlayPiece,
  paintSign,
  shadeOf,
} from '@/web/scene/render2d/street/park-props'
import { paintSideParks, paintSouthPark } from '@/web/scene/render2d/street/park-sides'
import { CAT_WALL, NORTH_PARK, PARKS, PLAY_PIECES } from '@/web/scene/sim/street/park-layout'
import { FAR_TREE_Y, FAR_TREES } from '@/web/scene/world/street-layout'
import { tr } from '@/web/text/tr'

// The lawn's mowing stripes, the back wall and its hedge, the flower ring round the fountain.
const LAWN = Object.freeze({ tone: '#9BD1A4', stripe: '#A8D6AE', stripeEvery: 24, stripeW: 12 })
const BACK = Object.freeze({ wall: '#7A8A7C', hedge: '#5FA877', step: 5, r: 3.1 })
const RUBBER = Object.freeze({ floor: '#C98270', fence: '#8FA4B8' })
const FLOWERS = Object.freeze({
  tones: ['#F27C9B', '#F6D55C', '#FFFFFF', '#B089E0'],
  count: 14,
  ring: 10.6,
  r: 0.7,
})
const WALL = Object.freeze({ body: '#B9A58C', cap: '#D4C3AA', h: 3.1, capH: 1.8, gap: 3 })
// The name plate stands beside the east gate.
const PLATE_DX = 13
const LAMPS = [
  [-70, -40, 1],
  [14, -40, -1],
  [100, -40, 1],
  [-60, -81, 1],
  [56, -81, -1],
  [120, -81, 1],
] as const
// The park's trees, north to south: where each stands and which crown it wears.
const TREES = [
  [-86, -84, 0],
  [-62, -84, 1],
  [-34, -84, 2],
  [-10, -84, 0],
  [16, -84, 1],
  [44, -84, 2],
  [72, -84, 0],
  [100, -84, 1],
  [128, -84, 2],
  [-34, -74, 0],
  [34, -73, 1],
  [58, -72, 2],
  [-93, -70, 1],
  [143, -70, 0],
  [-64, -70, 2],
  [-93, -47, 2],
  [143, -47, 1],
  [-70, -47, 0],
  [100, -46, 0],
  [124, -46, 1],
  [-30, -45, 1],
  [70, -44, 2],
] as const
// Street trees in front of the park (this close west of it) are drawn again over it.
const FRONT_TREE_REACH = 8

/** The four parks: the north park behind the far pavement, a park beside each side street and
 *  the south park under the plaza. Their people and animals are on the moving layer. */
export const PARK_PART: PaintPart = {
  paintStatic: (g, pack, minute) => {
    const scene = citySceneOf(g, pack, minute)

    paintNorthPark(scene, pack)
    paintSideParks(scene)
    paintSouthPark(scene)
  },
}

// Lawn, paths, fountain, playground, benches, lamps, trees, the front hedge with its gates and the
// cat's wall, the name plate, and the street trees in front of it all.
function paintNorthPark(scene: CityScene, pack: RegionPack): void {
  const park = PARKS[0]
  const { fountain } = NORTH_PARK

  paintLawn(scene)
  paintPaths(scene, park)
  paintPlayground(scene)
  paintFlowerRing(scene)
  paintFountain(scene, fountain)

  for (const bench of park.benches) {
    paintBench(scene, bench)
  }

  for (const piece of PLAY_PIECES) {
    paintPlayPiece(scene, piece)
  }

  for (const [x, y, side] of LAMPS) {
    paintLamp(scene, { x, y }, side)
  }

  for (const [x, y, kind] of TREES) {
    paintTree(scene, { x, y }, kind)
  }

  paintFront(scene, pack)
}

function paintLawn(scene: CityScene): void {
  const { g } = scene
  const { x0, x1, y0, y1 } = NORTH_PARK

  g.fillStyle = shadeOf(scene, LAWN.tone)
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.fillStyle = shadeOf(scene, LAWN.stripe)

  for (let x = x0; x < x1; x += LAWN.stripeEvery) {
    g.fillRect(x, y0, Math.min(LAWN.stripeW, x1 - x), y1 - y0)
  }

  g.fillStyle = shadeOf(scene, BACK.wall)
  g.fillRect(x0, y0 - 0.4, x1 - x0, 1.4)
  g.fillStyle = shadeOf(scene, BACK.hedge)

  for (let x = x0 + 2; x < x1; x += BACK.step) {
    g.beginPath()
    g.arc(x, y0 + 0.6, BACK.r, 0, Math.PI * 2)
    g.fill()
  }
}

function paintPlayground(scene: CityScene): void {
  const { g } = scene
  const { x0, y0, x1, y1 } = NORTH_PARK.rubber

  g.fillStyle = shadeOf(scene, RUBBER.floor)
  g.fillRect(x0, y0, x1 - x0, y1 - y0)
  g.strokeStyle = shadeOf(scene, RUBBER.fence)
  g.lineWidth = 0.5
  g.strokeRect(x0, y0, x1 - x0, y1 - y0)
}

function paintFlowerRing(scene: CityScene): void {
  const { g } = scene
  const { fountain } = NORTH_PARK

  for (let index = 0; index < FLOWERS.count; index++) {
    const angle = (index * Math.PI * 2) / FLOWERS.count

    g.fillStyle = shadeOf(scene, FLOWERS.tones[index % FLOWERS.tones.length] ?? LAWN.tone)
    g.beginPath()
    g.arc(
      fountain.x + Math.cos(angle) * FLOWERS.ring,
      fountain.y + Math.sin(angle) * FLOWERS.ring,
      FLOWERS.r,
      0,
      Math.PI * 2
    )
    g.fill()
  }
}

// The hedge and railing along the far pavement, open at both gates and broken by the cat's low
// wall; the park's name by the east gate; the street trees standing in front.
function paintFront(scene: CityScene, pack: RegionPack): void {
  const { g } = scene
  const park = PARKS[0]
  const line = NORTH_PARK.y1 - 1.4
  const gates = park.gates.map((gate) => park.nodes[gate]?.x ?? 0)
  const wallFrom = CAT_WALL.x - CAT_WALL.half

  paintHedgeRail(scene, {
    line,
    from: NORTH_PARK.x0 + 2,
    to: wallFrom - WALL.gap,
    isAlongX: true,
    gaps: gates,
  })
  g.fillStyle = shadeOf(scene, WALL.body)
  g.fillRect(wallFrom, CAT_WALL.top + 0.7, CAT_WALL.half * 2, WALL.h)
  g.fillStyle = shadeOf(scene, WALL.cap)
  g.fillRect(wallFrom, CAT_WALL.top - 1.1, CAT_WALL.half * 2, WALL.capH)
  paintSign(scene, {
    at: { x: (gates.at(-1) ?? 0) + PLATE_DX, y: line },
    text: tr('ui.office.street.parkName', { name: pack.park }),
    isPlate: true,
  })

  for (const tree of FAR_TREES) {
    if (tree.x > NORTH_PARK.x0 - FRONT_TREE_REACH && tree.x < NORTH_PARK.x1) {
      paintTree(scene, { x: tree.x, y: FAR_TREE_Y }, tree.kind)
    }
  }
}

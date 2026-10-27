import type { Recipe } from '@/web/scene/render3d/props'
import { box } from '@/web/scene/render3d/boxes'
import { DARKWOOD } from '@/web/scene/sprites/palette'

// The mockup's tank: a dark rim on the cabinet, a lid strip at the back and thin rails round an
// open top, corner posts, sand, weed and a stone; the water and the lid's light are fish.ts's.
const TANK = Object.freeze({
  rim: '#3A404C',
  lid: '#E7E9EE',
  rail: '#C9CED8',
  sand: '#E6D3A3',
  weed: '#4FA373',
  weedDark: '#3F9163',
  stone: '#A9A6B8',
})

// Seen from above the open top, so the fish show through the water and not under a lid.
export const tankRecipe: Recipe = ({ prop, out }) => {
  const { x, y: z, w, h: d } = prop.rect

  out.push(box([x, z, w, d, 0, 8], DARKWOOD[1], true))
  out.push(
    box([x - 0.4, z - 0.4, w + 0.8, d + 0.8, 8, 0.8], TANK.rim),
    box([x - 0.4, z - 0.4, w + 0.8, 1.5, 17.2, 1.2], TANK.lid),
    box([x - 0.4, z + d - 0.6, w + 0.8, 1, 17.2, 0.7], TANK.rail),
    box([x - 0.4, z - 0.4, 0.8, d + 0.8, 17.2, 0.7], TANK.rail),
    box([x + w - 0.4, z - 0.4, 0.8, d + 0.8, 17.2, 0.7], TANK.rail),
    box([x + 0.2, z + 0.2, w - 0.4, d - 0.4, 8.8, 1.2], TANK.sand),
    box([x + 7, z + 5, 1, 1, 10, 6], TANK.weed),
    box([x + 8.4, z + 6, 1, 1, 10, 4], TANK.weed),
    box([x + 25, z + 4, 1, 1, 10, 7], TANK.weedDark),
    box([x + 16, z + 7, 3.5, 2.5, 10, 2], TANK.stone)
  )

  for (const [px, pz] of [
    [x - 0.4, z - 0.4],
    [x + w - 0.3, z - 0.4],
    [x - 0.4, z + d - 0.3],
    [x + w - 0.3, z + d - 0.3],
  ] as const) {
    out.push(box([px, pz, 0.7, 0.7, 8.8, 9], TANK.rail))
  }
}

import type { FloorId, Point, Rect } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { propsOn } from '@/web/scene/world/props'

// A desk monitor's box starts this far over its desk's top.
const MONITOR_RISE = 9
/** A desk screen's glass height in world px; a screen too small for text draws its bars by it. */
export const GLASS_H = 7
// The mockup's reach: whoever stands within this of a desk's middle, from a little above its top
// to below its front edge, is the one at its computer.
const AT_COMPUTER_DX = 26
const AT_COMPUTER_ABOVE = 12
const AT_COMPUTER_BELOW = 34

/** The glass of a desk computer standing on its desk: inside the bezel, the mockup's 14 by 7. */
export function standingScreenOf(computer: {
  readonly x: number
  readonly y: number
  readonly w: number
}): Rect {
  return { x: computer.x + 1, y: computer.y + 1, w: computer.w - 2, h: GLASS_H }
}

/** The computer on `floor` that someone standing at `at` works at: the nearest in line with them,
 *  none for a person who stands off to the side or behind a desk. */
export function computerAt(floor: FloorId, at: Point): PropDef | undefined {
  return propsOn(floor)
    .filter((prop) => prop.kind === 'computer')
    .map((prop) => ({ prop, gap: Math.abs(at.x - (prop.draw.x + prop.draw.w / 2)) }))
    .filter(({ prop, gap }) => {
      const top = prop.draw.y + MONITOR_RISE

      return (
        gap < AT_COMPUTER_DX && at.y > top - AT_COMPUTER_ABOVE && at.y < top + AT_COMPUTER_BELOW
      )
    })
    .sort((a, b) => a.gap - b.gap)[0]?.prop
}

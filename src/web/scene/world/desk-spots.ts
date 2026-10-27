import type { FloorId, Point, Rect } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { propsOn } from '@/web/scene/world/props'

// A desk monitor's box starts this far over its desk's top; laid flat it sits a px into the desk.
const MONITOR_RISE = 9
const FLAT_SCREEN_DROP = 2
/** A flat desk screen's height in world px, which a screen too small for text draws its bars by. */
export const FLAT_SCREEN_H = 7
// The mockup's reach: whoever stands within this of a desk's middle, from a little above its top
// to below its front edge, is the one at its computer.
const AT_COMPUTER_DX = 26
const AT_COMPUTER_ABOVE = 12
const AT_COMPUTER_BELOW = 34

/** The glass of a desk computer laid flat on its desk while someone sits at it, as the mockup lays
 *  it so the screen never prints on the sitter: 2D draws it there and its lit face goes there. */
export function flatScreenOf(computer: PropDef): Rect {
  const { x, y, w } = computer.draw

  return { x: x + 1, y: y + MONITOR_RISE + FLAT_SCREEN_DROP, w: w - 2, h: FLAT_SCREEN_H }
}

/** Where a desk's top centre sits, for the desk and the computer on it alike: `x` its middle,
 *  `y` the desk top. */
export function deskSpotOf(prop: PropDef): string {
  const { x, y, w } = prop.draw
  const top = prop.kind === 'computer' ? y + MONITOR_RISE : y

  return `${x + w / 2}:${top}`
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

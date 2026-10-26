import type { Rect } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'

// A desk monitor's box starts this far over its desk's top; laid flat it sits a px into the desk.
const MONITOR_RISE = 9
const FLAT_SCREEN_DROP = 2
const FLAT_SCREEN_H = 7

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

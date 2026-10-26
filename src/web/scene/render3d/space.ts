import { Color } from 'three'

/** World px per three.js unit: a floor point (x, y) at height h stands at (x, h, y) / `UNIT_PX`. */
export const UNIT_PX = 16
/** The fixed camera looks north and down at this angle. */
export const ELEVATION = (52 * Math.PI) / 180
/** A point this many px up shows `HEIGHT_K` times as far up the screen as a step north does. */
export const HEIGHT_K = Math.cos(ELEVATION) / Math.sin(ELEVATION)
/** A full wall's height, in world px. */
export const WALL_PX = 36

const scratch = new Color()

export function toUnits(px: number): number {
  return px / UNIT_PX
}

/** `hex` moved `share` of the way to `toward`, as a hex number. */
export function mixHex(hex: string, toward: string, share: number): number {
  return scratch.set(hex).lerp(new Color(toward), share).getHex()
}

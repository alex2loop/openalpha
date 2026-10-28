import type { Build } from '@/web/scene/render3d/props'
import { box } from '@/web/scene/render3d/boxes'
import { METAL } from '@/web/scene/sprites/palette'

// The mockup's water cooler: its body and top plate, and the 19 L bottle upside down on it, the
// water to its level and the air above it (2D paints the same bottle row by row).
const COOLER = Object.freeze({
  body: 24,
  plate: '#F4F6F9',
  panel: '#C9D1DE',
  coldTap: '#4F8FD6',
  hotTap: '#D8625A',
  tray: '#8A919E',
  grill: '#5C6474',
})
const BOTTLE_WATER = '#5AAAE9'
const BOTTLE_AIR = '#D9EFFB'
// The bottle's tiers from its neck, over the cooler's top: half width, rise, height and tone.
const BOTTLE_TIERS: readonly (readonly [number, number, number, string])[] = Object.freeze([
  [1.7, -0.6, 2, BOTTLE_WATER],
  [3.5, 1.4, 3, BOTTLE_WATER],
  [4.3, 4.4, 7.2, BOTTLE_WATER],
  [4.46, 7.1, 0.5, '#3F86CC'],
  [4.46, 10.1, 0.5, '#3F86CC'],
  [4.3, 11.6, 2.4, BOTTLE_AIR],
  [3.2, 14, 2.2, BOTTLE_AIR],
  [1.8, 16.2, 0.6, BOTTLE_AIR],
])

/** The water cooler: its body with the taps and drip tray on the front, the top plate, then the
 *  bottle in tiers from its neck: shoulder, the ribbed body under water, the air above it. */
export function coolerOf({ prop, out }: Build): void {
  const { x, y, w, h } = prop.rect
  const front = y + h
  const cx = x + w / 2
  const cz = y + h / 2
  const base = COOLER.body + 1.8

  out.push(
    box([x, y, w, h, 0, COOLER.body], METAL[1], true),
    box([x - 0.4, y - 0.4, w + 0.8, h + 0.8, COOLER.body, 1.2], METAL[0], true),
    box([x + 2.4, y + 1.6, w - 4.8, h - 3.2, COOLER.body + 1.2, 0.7], COOLER.plate),
    box([x + 1, front, w - 2, 0.3, 11, 10], COOLER.panel),
    box([x + 2.4, front + 0.3, 2.4, 1.4, 15.5, 1.6], COOLER.coldTap),
    box([x + w - 4.8, front + 0.3, 2.4, 1.4, 15.5, 1.6], COOLER.hotTap),
    box([x + 2, front + 0.1, w - 4, 2.4, 9, 1], COOLER.tray),
    box([x + 2.6, front + 0.7, w - 5.2, 1.4, 9.9, 0.4], COOLER.grill),
    ...BOTTLE_TIERS.map(([r, from, tall, tone]) =>
      box([cx - r, cz - r, r * 2, r * 2, base + from, tall], tone, true)
    )
  )
}

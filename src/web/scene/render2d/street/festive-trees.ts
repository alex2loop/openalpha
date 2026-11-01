import type { HolidayId } from '@/web/scene/world/regions'
import { createRng, seedOf } from '@/web/scene/world/rng'

// Peach blossom and apricot: the tree colours of the Tết weeks, for the crowns that are not green.
const BLOSSOMS = ['#F5A3BB', '#F6D24A'] as const
const GREEN_LOOK = 0
const LOOKS = 3
const BULBS = ['#FF5A4D', '#FFD84A', '#5AD1FF', '#8CE06A', '#FF8CD9'] as const
const BULB_COUNT = 9
const BULB_SPREAD = 0.78
const BULB_STRETCH = Object.freeze({ x: 1.05, y: 0.82 })
const BULB_R = 0.55
const GLOW_R = 1.7
const GLOW_FROM_DARK = 0.3
const GLOW_ALPHA = 0.3

/** The crown colour a tree of this `look` wears on `holiday`: blossom in the Tết weeks for all but
 *  the green look; none the rest of the year. */
export function blossomOf(holiday: HolidayId | undefined, look: number): string | undefined {
  const turn = look % LOOKS

  return holiday === 'tet' && turn !== GREEN_LOOK ? BLOSSOMS[turn - 1] : undefined
}

/** Christmas lights scattered over a crown centred at `x`, `y`: coloured bulbs, glowing after
 *  dusk. */
export function paintCrownLights(
  g: CanvasRenderingContext2D,
  crown: {
    readonly x: number
    readonly y: number
    readonly radius: number
    readonly look: number
    readonly dark: number
  }
): void {
  const rng = createRng(seedOf('crown-lights', String(crown.look)))

  for (let i = 0; i < BULB_COUNT; i++) {
    const angle = rng.next() * Math.PI * 2
    const reach = rng.next() * BULB_SPREAD * crown.radius
    const x = crown.x + Math.cos(angle) * reach * BULB_STRETCH.x
    const y = crown.y + Math.sin(angle) * reach * BULB_STRETCH.y
    const colour = BULBS[(i + crown.look) % BULBS.length] ?? BULBS[0]

    if (crown.dark > GLOW_FROM_DARK) {
      g.globalAlpha = GLOW_ALPHA * crown.dark
      g.fillStyle = colour
      g.beginPath()
      g.arc(x, y, GLOW_R, 0, Math.PI * 2)
      g.fill()
    }

    g.globalAlpha = 1
    g.fillStyle = colour
    g.beginPath()
    g.arc(x, y, BULB_R, 0, Math.PI * 2)
    g.fill()
  }
}

import type { Point } from '@/web/scene/types'
import { drawBlock, fill, INK } from '@/web/scene/render2d/building'
import { METAL } from '@/web/scene/sprites/palette'

// The mockup's water cooler: a 19 L blue bottle upside down on a cooler. The prop's draw box starts
// at the bottle's top, the body this far below it.
const BODY_DROP = 17
// The bottle's half width per row from the neck up, its centre and neck row in the sprite, and the
// last row under water.
const BOTTLE_ROWS = [1, 1, 2, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 2] as const
const BOTTLE_CX = 7
const BOTTLE_NECK = 19
const WATER_ROW = 11
const RIBS: ReadonlySet<number> = new Set([7, 10])
const WATER = Object.freeze({ body: '#5AAAE9', rib: '#3F86CC', lit: '#BFE3FA', edge: '#3F86CC' })
const WATER_SHINE = '#8CCBF2'
const AIR = Object.freeze({ body: '#D9EFFB', rib: '#9CC8E8', lit: '#FFFFFF', edge: '#B5D6EE' })
const BUBBLE = '#EAF6FF'
const BUBBLES = 6
const BUBBLE_MS = 1_500

/** The cooler's body with its taps and drip tray, then the bottle on top, row by row. */
export function paintCooler(g: CanvasRenderingContext2D, at: Point): void {
  const { x } = at
  const y = at.y + BODY_DROP

  drawBlock(g, [x, y, 12, 6], { front: 18, tones: METAL })
  fill(g, [x + 1, y + 7, 10, 1], METAL[0])
  fill(g, [x + 2, y + 9, 3, 2], INK)
  fill(g, [x + 3, y + 9, 1, 1], '#4F8FD6')
  fill(g, [x + 7, y + 9, 3, 2], INK)
  fill(g, [x + 8, y + 9, 1, 1], '#D8625A')
  fill(g, [x + 2, y + 18, 8, 3], INK)
  fill(g, [x + 3, y + 19, 6, 1], '#5C6474')
  paintTop(g, { x: x - 1, y: at.y })
  paintBottle(g, { x: x - 1, y: at.y })
}

/** Six bubbles rising from the neck to the water's top while someone takes water; `now` 0 holds
 *  them still. */
export function paintCoolerBubbles(g: CanvasRenderingContext2D, top: Point, now: number): void {
  const cx = Math.round(top.x)
  const neck = Math.round(top.y) + BOTTLE_NECK

  for (let i = 0; i < BUBBLES; i++) {
    const v = (now / BUBBLE_MS + i / BUBBLES + (i % 2) * 0.06) % 1
    const u = Math.sin(i * 2.3 + v * 4) * (v < 0.2 ? 0.3 : 0.62)
    const row = 2 + Math.round(v * (WATER_ROW - 4))
    const half = BOTTLE_ROWS[row] ?? 1

    fill(g, [cx + Math.round(u * (half - 1)), neck - row, 1, 1], BUBBLE)
  }
}

// The cooler's top plate and its collar, in sprite px from `o`.
function paintTop(g: CanvasRenderingContext2D, o: Point): void {
  fill(g, [o.x, o.y + 16, 14, 1], INK)
  fill(g, [o.x, o.y + 17, 1, 6], INK)
  fill(g, [o.x + 13, o.y + 17, 1, 6], INK)
  fill(g, [o.x + 1, o.y + 17, 12, 6], METAL[1])
  fill(g, [o.x + 1, o.y + 17, 12, 1], METAL[0])
  fill(g, [o.x + 4, o.y + 18, 6, 2], INK)
  fill(g, [o.x + 5, o.y + 18, 4, 1], '#F4F6F9')
}

function paintBottle(g: CanvasRenderingContext2D, o: Point): void {
  const cx = o.x + BOTTLE_CX
  const neck = o.y + BOTTLE_NECK

  for (const [i, half] of BOTTLE_ROWS.entries()) {
    fill(g, [cx - half - 1, neck - i, half * 2 + 3, 1], INK)
  }

  fill(g, [cx - 2, neck - BOTTLE_ROWS.length, 5, 1], INK)
  fill(g, [cx - 1, neck + 1, 3, 1], INK)

  for (const [i, half] of BOTTLE_ROWS.entries()) {
    const tone = i <= WATER_ROW ? WATER : AIR
    const isRib = RIBS.has(i)

    fill(g, [cx - half, neck - i, half * 2 + 1, 1], isRib ? tone.rib : tone.body)

    if (half >= 2) {
      fill(g, [cx - half, neck - i, 1, 1], tone.lit)
      fill(g, [cx + half, neck - i, 1, 1], tone.edge)
    }

    if (half >= 3 && i <= WATER_ROW) {
      fill(g, [cx - half + 1, neck - i, 1, 1], WATER_SHINE)
    }
  }

  fill(g, [cx - 3, neck - WATER_ROW, 7, 1], '#CFEAFC')
  fill(g, [cx - 1, neck - BOTTLE_ROWS.length + 1, 3, 1], '#C6E0F2')
}

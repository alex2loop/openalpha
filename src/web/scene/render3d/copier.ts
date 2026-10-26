import type { Build } from '@/web/scene/render3d/props'
import { isPrintingRun, roomStatus } from '@/web/scene/data/room-status'
import { box } from '@/web/scene/render3d/boxes'
import { beginPool, endPool, type Pool, placeInstance } from '@/web/scene/render3d/instancing'
import { PALETTE } from '@/web/scene/sprites/palette'
import { propsOn } from '@/web/scene/world/props'

// The mockup's copier: body, lid, drawer fronts and pull, the side output tray, the screen base.
const BODY = Object.freeze({ w: 18, d: 14, h: 24, tone: '#E9E6DF' })
const LID = '#CFCBC2'
const DRAWER = '#B9B5AB'
const PULL = '#8E8A80'
const SCREEN_BASE = '#7C8394'
// One run: the scanner light sweeps for the first half, three sheets slide into the tray.
const RUN_MS = 2_400
const RUN_SHEETS = 3
const TRAY_SHEETS = 8
const BAR = Object.freeze({ w: 16, h: 0.5, d: 0.5, y: 24.7, from: 2, sweep: 10, tone: '#9FE7FF' })
const SHEET = Object.freeze({
  w: 7.4,
  h: 0.28,
  d: 5.4,
  x: 23,
  y: 13.4,
  step: 0.38,
  z: 7.5,
  slide: 9,
})
const COPIER = propsOn('office').find((prop) => prop.kind === 'copier')

/** The copier's run: when the library's report finishes printing, the scanner sweeps and three
 *  sheets slide into its tray, which keeps them while the page stays open. */
export interface CopierRun {
  wasPrinting: boolean
  startedAt: number | undefined
  stack: number
}

export function createCopierRun(): CopierRun {
  return { wasPrinting: false, startedAt: undefined, stack: 0 }
}

/** The copier's boxes, as the mockup's `copier3`. */
export function copierOf({ prop, out }: Build): void {
  const { x, y } = prop.rect

  out.push(
    box([x, y, BODY.w, BODY.d, 0, BODY.h], BODY.tone, true),
    box([x - 0.5, y - 0.5, BODY.w + 1, BODY.d + 1, BODY.h, 3], LID, true),
    box([x + 1.5, y + BODY.d, 15, 0.5, 3, 5.4], DRAWER),
    box([x + 6.5, y + BODY.d + 0.3, 5, 0.4, 6, 0.9], PULL),
    box([x + 1.5, y + BODY.d, 15, 0.5, 10, 5.4], DRAWER),
    box([x + 19, y + 3, 8, 9, 12.4, 1], LID),
    box([x + 18.4, y + 3, 0.6, 9, 12.4, 3], DRAWER),
    box([x + 9, y + 8, 8, 5, prop.height, 1.4], SCREEN_BASE)
  )
}

/** Places the scanner light and the tray's sheets on the office floor; `isMoving` while a run
 *  plays (a reduced-motion page shows its end at once). */
export function syncCopierRun(
  run: CopierRun,
  at: {
    readonly pool: Pool
    readonly isOffice: boolean
    readonly now: number
    readonly isReduced: boolean
  }
): { readonly isChanged: boolean; readonly isMoving: boolean } {
  const isPrinting = isPrintingRun(roomStatus.value.get('lib')?.runs[0])

  if (run.wasPrinting && !isPrinting) {
    run.startedAt = at.now
    run.stack = Math.min(TRAY_SHEETS, run.stack + RUN_SHEETS)
  }

  run.wasPrinting = isPrinting

  const k =
    run.startedAt === undefined || at.isReduced ? 1 : Math.min(1, (at.now - run.startedAt) / RUN_MS)

  if (k >= 1) {
    run.startedAt = undefined
  }

  const key = `${at.isOffice}|${run.stack}|${k}`

  if (COPIER === undefined || !beginPool(at.pool, key)) {
    return { isChanged: false, isMoving: false }
  }

  if (at.isOffice) {
    placeRun(at.pool, { stack: run.stack, k, x: COPIER.rect.x, z: COPIER.rect.y })
  }

  endPool(at.pool)

  return { isChanged: true, isMoving: k < 1 }
}

function placeRun(
  pool: Pool,
  at: { readonly stack: number; readonly k: number; readonly x: number; readonly z: number }
): void {
  const { stack, k, x, z } = at
  const eased = 1 - (1 - k) ** 3

  if (k < 1) {
    placeInstance(pool, {
      x: x + 1 + BAR.w / 2,
      y: BAR.y,
      z: z + BAR.from + Math.min(1, k * 2) * BAR.sweep,
      size: [BAR.w, BAR.h, BAR.d],
      color: BAR.tone,
    })
  }

  for (let i = 0; i < stack; i++) {
    const slide = i >= stack - RUN_SHEETS ? (1 - eased) * SHEET.slide : 0

    placeInstance(pool, {
      x: x + SHEET.x - slide,
      y: SHEET.y + i * SHEET.step,
      z: z + SHEET.z,
      size: [SHEET.w, SHEET.h, SHEET.d],
      color: PALETTE.paper,
    })
  }
}

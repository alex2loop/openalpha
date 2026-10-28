import type { PaperView } from '@/web/scene/types'
import { DEVICE_TONES, OUTLINE } from '@/web/scene/sprites/palette'
import { TRAY_STACK } from '@/web/scene/world/seats'

const SHEET_FACE = '#FFFFFF'
const SHEET_RULE = '#9AA0B4'
// A flying sheet arcs this high at mid-flight.
const ARC_PX = 12
// Each sheet on the tray sits this much above the one below.
const STACK_STEP_PX = 1
const TRAY_SHEETS_MAX = 6
const TRAY_SHEET_W = 6
const TRAY_SHEET_EDGE = '#E2E5EC'

/** The sheets in flight between the last two sim steps, each on a small arc. */
export function paintPapers(
  g: CanvasRenderingContext2D,
  papers: readonly PaperView[],
  alpha: number
): void {
  for (const paper of papers) {
    const k = paper.prevK + (paper.k - paper.prevK) * alpha
    const x = paper.from.x + (paper.to.x - paper.from.x) * k
    const y = paper.from.y + (paper.to.y - paper.from.y) * k - Math.sin(Math.PI * k) * ARC_PX

    sheet(g, Math.round(x), Math.round(y))
  }
}

/** The operator's tray stack, one sheet per waiting approval and unread notice, as high as the
 *  tray holds. */
export function paintTray(g: CanvasRenderingContext2D, count: number): void {
  for (let i = 0; i < Math.min(TRAY_SHEETS_MAX, count); i++) {
    const y = TRAY_STACK.y - i * STACK_STEP_PX

    g.fillStyle = DEVICE_TONES.page
    g.fillRect(TRAY_STACK.x, y, TRAY_SHEET_W, 2)
    g.fillStyle = TRAY_SHEET_EDGE
    g.fillRect(TRAY_STACK.x, y, TRAY_SHEET_W, 1)
  }
}

// A flying sheet as the mockup's: a white page in its outline with two ruled lines.
function sheet(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = OUTLINE
  g.fillRect(x - 4, y - 3, 8, 7)
  g.fillStyle = SHEET_FACE
  g.fillRect(x - 3, y - 2, 6, 5)
  g.fillStyle = SHEET_RULE
  g.fillRect(x - 2, y - 1, 4, 1)
  g.fillRect(x - 2, y + 1, 3, 1)
}

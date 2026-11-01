import type { Rect } from '@/web/scene/types'
import { FONT } from '@/web/scene/sprites/face-text'
import { PALETTE } from '@/web/scene/sprites/palette'
import { tr } from '@/web/text/tr'

const CHECKLIST = Object.freeze({
  head: '#D8514B',
  box: '#8E8497',
  line: '#B7BBD0',
  tick: '#2E9E57',
})
const CHECK_ROWS = 6
const TICKED_ROWS = 4

/** The risk desk's checklist. While its owner sits idle it reads the book: one red box for each
 *  holding near its stop (the count in its head from the room zoom), every other row ticked. */
export function paintChecklist(
  c: CanvasRenderingContext2D,
  at: { readonly cell: Rect; readonly isFine: boolean; readonly nearStops: number | undefined }
): void {
  const { x, y, w, h } = at.cell
  const { nearStops } = at
  const ticked = nearStops === undefined ? TICKED_ROWS : CHECK_ROWS

  c.fillStyle = PALETTE.paper
  c.fillRect(x, y, w, h)
  c.fillStyle = CHECKLIST.head
  c.fillRect(x, y, w, 18)
  c.fillStyle = PALETTE.paper

  if (at.isFine) {
    const head =
      nearStops === undefined
        ? tr('ui.office.desks.checklist')
        : tr('ui.office.desks.nearStops', { count: nearStops })

    c.font = `700 11px ${FONT}`
    c.textAlign = 'left'
    c.fillText(head, x + 7, y + 9.5, w - 14)
  } else {
    c.fillRect(x + 7, y + 7, 52, 4)
  }

  for (let i = 0; i < CHECK_ROWS; i++) {
    const rowY = y + 28 + i * 16
    const isNear = nearStops !== undefined && i < nearStops

    c.strokeStyle = CHECKLIST.box
    c.lineWidth = 1.4
    c.strokeRect(x + 8, rowY, 9, 9)
    c.fillStyle = CHECKLIST.line
    c.fillRect(x + 24, rowY + 3, 50 + ((i * 17) % 30), 3)

    if (isNear) {
      c.fillStyle = CHECKLIST.head
      c.fillRect(x + 8, rowY, 9, 9)
    } else if (i < ticked) {
      c.strokeStyle = CHECKLIST.tick
      c.lineWidth = 2
      c.beginPath()
      c.moveTo(x + 9.5, rowY + 5)
      c.lineTo(x + 12.5, rowY + 8)
      c.lineTo(x + 19, rowY - 2)
      c.stroke()
    }
  }
}

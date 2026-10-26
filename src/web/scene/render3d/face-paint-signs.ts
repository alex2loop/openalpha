import { FONT } from '@/web/scene/sprites/screens'

// The mockup's lift indicator, laid out on its 144 by 40 canvas.
const LIFT_W = 144
const LIFT = Object.freeze({
  rim: '#14161F',
  well: '#262A3A',
  on: '#FFB340',
  off: '#5A5F78',
  digitPx: 28,
  digitInset: 30,
  ringR: 7,
})
// The mockup's vending front, laid out on its 144 by 224 canvas.
const VENDING_W = 144
const VENDING = Object.freeze({
  body: '#E9E3F2',
  glass: '#2B3050',
  open: '#FFE9A8',
  shut: '#4B5370',
  openInk: '#3A3F58',
  shutInk: '#7C84A8',
  tray: '#CBC3DC',
  slot: '#8C86A8',
  rows: 3,
})
const PLAQUE = Object.freeze({ paper: '#F7F3EA', ink: '#2B2433' })
const COPIER = Object.freeze({ panel: '#0F1428', busy: '#6FE3D6', idle: '#9FB0DC' })

/** One market's slot in the vending machine: the name it shows and whether it trades now. */
export interface VendingRow {
  readonly name: string
  readonly isOpen: boolean
}

/** The lift's indicator: a digit per floor, the car's floor lit, a ring while this floor called. */
export function paintLift(
  c: CanvasRenderingContext2D,
  lift: { readonly digits: readonly string[]; readonly at: number; readonly isCalled: boolean }
): void {
  const { width: w, height: h } = c.canvas
  const k = w / LIFT_W

  c.fillStyle = LIFT.rim
  c.fillRect(0, 0, w, h)
  c.fillStyle = LIFT.well
  c.fillRect(3 * k, 3 * k, w - 6 * k, h - 6 * k)
  c.font = `700 ${LIFT.digitPx * k}px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'

  const step = lift.digits.length > 1 ? (w - 2 * LIFT.digitInset * k) / (lift.digits.length - 1) : 0

  for (const [i, digit] of lift.digits.entries()) {
    c.fillStyle = i === lift.at ? LIFT.on : LIFT.off
    c.fillText(digit, LIFT.digitInset * k + i * step, h / 2 + 2 * k)
  }

  if (lift.isCalled) {
    c.strokeStyle = LIFT.on
    c.lineWidth = 3 * k
    c.beginPath()
    c.arc(w / 2, h / 2, LIFT.ringR * k, 0, Math.PI * 2)
    c.stroke()
  }
}

/** The vending machine's front: a lit slot per market while it trades, then the tray. */
export function paintVending(c: CanvasRenderingContext2D, rows: readonly VendingRow[]): void {
  const { width: w, height: h } = c.canvas
  const k = w / VENDING_W
  const glassH = h * 0.62
  const rowH = (glassH - 16 * k) / VENDING.rows

  c.fillStyle = VENDING.body
  c.fillRect(0, 0, w, h)
  c.fillStyle = VENDING.glass
  c.fillRect(6 * k, 6 * k, w - 12 * k, glassH)
  c.textAlign = 'center'
  c.textBaseline = 'middle'

  for (const [i, row] of rows.slice(0, VENDING.rows).entries()) {
    const y = 12 * k + i * ((glassH - 12 * k) / VENDING.rows)

    c.fillStyle = row.isOpen ? VENDING.open : VENDING.shut
    c.fillRect(10 * k, y, w - 20 * k, rowH - 4 * k)
    c.fillStyle = row.isOpen ? VENDING.openInk : VENDING.shutInk
    c.font = `700 ${rowH * 0.42}px ${FONT}`
    c.fillText(row.name, w / 2, y + rowH / 2 - 2 * k, w - 28 * k)
  }

  c.fillStyle = VENDING.tray
  c.fillRect(w * 0.2, h * 0.78, w * 0.6, h * 0.12)
  c.fillStyle = VENDING.slot
  c.fillRect(w * 0.3, h * 0.82, w * 0.4, h * 0.05)
}

/** A plaque with one word on it, as the front desk carries its name. */
export function paintPlaque(c: CanvasRenderingContext2D, text: string): void {
  const { width: w, height: h } = c.canvas

  c.fillStyle = PLAQUE.paper
  c.fillRect(0, 0, w, h)
  c.fillStyle = PLAQUE.ink
  c.font = `700 ${h * 0.55}px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(text, w / 2, h / 2 + h * 0.02, w * 0.92)
}

/** The copier's control screen: what it is doing, in the busy or the idle tone. */
export function paintCopier(
  c: CanvasRenderingContext2D,
  copier: { readonly text: string; readonly isBusy: boolean }
): void {
  const { width: w, height: h } = c.canvas

  c.fillStyle = COPIER.panel
  c.fillRect(0, 0, w, h)
  c.fillStyle = copier.isBusy ? COPIER.busy : COPIER.idle
  c.font = `700 ${h * 0.32}px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(copier.text, w / 2, h / 2, w * 0.9)
}

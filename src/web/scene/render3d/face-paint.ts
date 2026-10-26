import type { toneOfPercent } from '@/web/text/figures'
import { stampToneOf } from '@/web/scene/sprites/palette'
import { FONT } from '@/web/scene/sprites/screens'
import { createRng } from '@/web/scene/world/rng'
import { MINUTES_PER_HOUR } from '@/web/text/time-units'

/** The canvas px a face takes per world px: at least this many, and at least `FACE_MIN_PX` across. */
const FACE_PX_PER_PX = 4
const FACE_MIN_PX = 256
const BOARD = Object.freeze({ paper: '#FCFBF8', edge: '#E3DFD8', ink: '#3A3F58' })
const MARKERS = ['#7C93D6', '#A596D9', '#6F7388'] as const
const TAPE = Object.freeze({ panel: '#171A2B', edge: '#2C3250', name: '#EEF0FA', flat: '#E9ECF8' })
const CLOCK = Object.freeze({ rim: '#D9CBB8', face: '#FFFDF8', tick: '#8E8497', hand: '#3A3F58' })
const CALENDAR = Object.freeze({ page: '#FBF9F3', band: '#D8514B', ink: '#2B2433' })
// The StandBy screen is laid out on the mockup's 256 by 160 canvas and scaled to the face.
const STANDBY_W = 256
// By night the screen turns red, as StandBy does in the dark.
const STANDBY_DAY = Object.freeze({
  bezel: '#04050A',
  top: '#3A5A9E',
  bottom: '#1F2C66',
  well: '#161A2E',
  tick: '#8C97C4',
  ink: '#FFFFFF',
  dim: '#9FB0DC',
  flowFrom: '#1B1E4B',
  flowTo: '#3C1E5A',
  move: undefined,
  banner: 'rgba(250,250,252,.96)',
  bannerInk: '#22263A',
  blobs: [
    ['rgba(120,170,255,.55)', 0.3, 0.4, 0.5],
    ['rgba(255,140,200,.5)', 0.7, 0.5, 0.9],
    ['rgba(120,240,210,.45)', 0.5, 0.7, 1.3],
  ],
} as const)
const STANDBY_NIGHT = Object.freeze({
  bezel: '#04050A',
  top: '#2A0707',
  bottom: '#1A0303',
  well: '#2A0808',
  tick: '#8A2A2A',
  ink: '#FF6A5A',
  dim: '#B04040',
  flowFrom: '#2A0606',
  flowTo: '#1A0303',
  move: '#FF6A5A',
  banner: 'rgba(90,20,20,.96)',
  bannerInk: '#FFB0A0',
  blobs: [
    ['rgba(255,70,50,.35)', 0.3, 0.4, 0.5],
    ['rgba(255,90,60,.3)', 0.7, 0.5, 0.9],
    ['rgba(200,50,40,.28)', 0.5, 0.7, 1.3],
  ],
} as const)
// The flow's soft blobs drift this far round their place, as shares of the screen.
const FLOW_DRIFT = Object.freeze({
  x: 0.18,
  y: 0.16,
  xRate: 0.35,
  yRate: 0.3,
  xPhase: 9,
  yPhase: 7,
})
// A quiet office dims the screen under this veil.
const STANDBY_VEIL = 'rgba(0,0,0,.55)'
// Each hand's length as a share of the dial's radius and its width in mockup px.
const CLOCK_HANDS = Object.freeze({ hour: [0.45, 7], minute: [0.68, 5] } as const)
const STANDBY_HANDS = Object.freeze({ hour: [0.5, 6], minute: [0.78, 4] } as const)
const HOURS_ON_DIAL = 12
const TICKS = 12
const FULL_TURN = Math.PI * 2

type Tone = ReturnType<typeof toneOfPercent>

/** A row of the alert desk's price board: a name, its signed move and the move's direction. */
export interface TapeRow {
  readonly name: string
  readonly move: string
  readonly tone: Tone
}

/** What a StandBy screen shows: the time, the date and, on the index view, the home index. */
export interface StandByView {
  readonly view: 'clock' | 'index' | 'flow'
  readonly time: string
  readonly date: string
  readonly minute: number
  readonly index?: { readonly label: string; readonly level: string; readonly move: TapeRow }
  readonly isNight: boolean
  readonly isDim: boolean
  /** Seconds the flow has drifted; 0 holds it still. */
  readonly flowSeconds: number
  /** A notice for the phone's desk, shown across its top for a few seconds after it arrives. */
  readonly banner?: string
}

type StandByLook = typeof STANDBY_DAY | typeof STANDBY_NIGHT

/** A face's canvas for `w` by `h` world px. */
export function sizeFace(canvas: HTMLCanvasElement, size: readonly [w: number, h: number]): void {
  const k = Math.max(FACE_PX_PER_PX, Math.ceil(FACE_MIN_PX / size[0]))

  canvas.width = Math.ceil(size[0] * k)
  canvas.height = Math.ceil(size[1] * k)
}

/** A whiteboard: marker scribbles seeded by the board, and the counter of the run at work in its
 *  room (the question asked, the debate step) when there is one. */
export function paintBoard(
  c: CanvasRenderingContext2D,
  board: { readonly count: string | undefined; readonly seed: number }
): void {
  const { width: w, height: h } = c.canvas
  const rng = createRng(board.seed)

  c.fillStyle = BOARD.paper
  c.fillRect(0, 0, w, h)
  c.strokeStyle = BOARD.edge
  c.lineWidth = h * 0.012
  c.strokeRect(0, 0, w, h)

  if (board.count !== undefined) {
    c.fillStyle = BOARD.ink
    c.font = `700 ${h * 0.5}px ${FONT}`
    c.textAlign = 'center'
    c.textBaseline = 'middle'
    c.fillText(board.count, w / 2, h * 0.34)
  }

  c.lineWidth = h * 0.022
  c.lineCap = 'round'
  c.lineJoin = 'round'

  for (const [i, tone] of MARKERS.entries()) {
    const y = h * (0.6 + i * 0.12)
    const length = w * (0.45 + rng.next() * 0.4)

    c.strokeStyle = tone
    c.beginPath()
    c.moveTo(w * 0.07, y)

    for (let x = w * 0.07; x < w * 0.07 + length; x += w * 0.05) {
      c.lineTo(x, y + (rng.next() - 0.5) * h * 0.06)
    }

    c.stroke()
  }
}

/** The alert desk's price board: a row per tape name with its move, or, too small to read, how
 *  many names are up and down. */
export function paintTape(
  c: CanvasRenderingContext2D,
  tape: { readonly rows: readonly TapeRow[]; readonly isTiny: boolean }
): void {
  const { width: w, height: h } = c.canvas

  c.fillStyle = TAPE.panel
  c.fillRect(0, 0, w, h)
  c.strokeStyle = TAPE.edge
  c.lineWidth = Math.max(2, h * 0.02)
  c.strokeRect(1, 1, w - 2, h - 2)
  c.textBaseline = 'middle'

  if (tape.isTiny) {
    const up = tape.rows.filter((row) => row.tone === 'up').length
    const down = tape.rows.filter((row) => row.tone === 'down').length

    c.font = `700 ${h * 0.38}px ${FONT}`
    c.textAlign = 'center'
    c.fillStyle = toneColour('up')
    c.fillText(`▲${up}`, w * 0.28, h / 2)
    c.fillStyle = toneColour('down')
    c.fillText(`▼${down}`, w * 0.72, h / 2)
    return
  }

  const pad = h * 0.07
  const rowH = (h - pad * 2) / Math.max(1, tape.rows.length)
  const size = rowH * 0.5

  for (const [i, row] of tape.rows.entries()) {
    const y = pad + rowH * (i + 0.5)

    c.font = `700 ${size}px ${FONT}`
    c.textAlign = 'left'
    c.fillStyle = TAPE.name
    c.fillText(row.name, pad, y)
    c.font = `600 ${size * 0.85}px ${FONT}`
    c.textAlign = 'right'
    c.fillStyle = toneColour(row.tone)
    c.fillText(row.move, w - pad, y)
  }
}

/** A wall clock's round face at `minute` of the day. */
export function paintClock(c: CanvasRenderingContext2D, minute: number): void {
  const { width: w } = c.canvas
  const r = w / 2

  c.clearRect(0, 0, w, c.canvas.height)
  disc(c, { x: r, y: r, r: r - 2, colour: CLOCK.rim })
  disc(c, { x: r, y: r, r: r - 10 * (w / 128), colour: CLOCK.face })
  dialTicks(c, { x: r, y: r, from: r * 0.69, to: r * 0.78, colour: CLOCK.tick, unit: w / 128 })
  hands(c, { x: r, y: r, r, minute, colour: CLOCK.hand, unit: w / 128, look: CLOCK_HANDS })
  disc(c, { x: r, y: r, r: 5 * (w / 128), colour: CLOCK.hand })
}

/** A desk calendar's page: a red band and today's day number. */
export function paintCalendar(c: CanvasRenderingContext2D, day: string): void {
  const { width: w, height: h } = c.canvas

  c.fillStyle = CALENDAR.page
  c.fillRect(0, 0, w, h)
  c.fillStyle = CALENDAR.band
  c.fillRect(0, 0, w, h * 0.28)
  c.fillStyle = CALENDAR.ink
  c.font = `700 ${h * 0.6}px ${FONT}`
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillText(day, w / 2, h * 0.63)
}

/** A StandBy phone's screen: a big clock and the date, an analog clock beside the home index, or a
 *  still gradient with the time under it. */
export function paintStandBy(c: CanvasRenderingContext2D, face: StandByView): void {
  const { width: w, height: h } = c.canvas
  const k = w / STANDBY_W
  const look = face.isNight ? STANDBY_NIGHT : STANDBY_DAY

  c.fillStyle = look.bezel
  c.fillRect(0, 0, w, h)
  c.save()
  c.beginPath()
  c.roundRect(7 * k, 7 * k, w - 14 * k, h - 14 * k, 16 * k)
  c.clip()

  const ground = c.createLinearGradient(0, 0, 0, h)

  ground.addColorStop(0, look.top)
  ground.addColorStop(1, look.bottom)
  c.fillStyle = ground
  c.fillRect(0, 0, w, h)
  c.textBaseline = 'middle'

  if (face.view === 'index') {
    paintIndexView(c, face, { k, look })
  } else if (face.view === 'clock') {
    c.textAlign = 'center'
    c.fillStyle = look.ink
    c.font = `700 ${78 * k}px ${FONT}`
    c.fillText(face.time, w / 2, 70 * k)
    c.fillStyle = look.dim
    c.font = `500 ${20 * k}px ${FONT}`
    c.fillText(face.date, w / 2, 124 * k)
  } else {
    paintFlowView(c, face, { k, look })
  }

  if (face.isDim) {
    c.fillStyle = STANDBY_VEIL
    c.fillRect(0, 0, w, h)
  }

  if (face.banner !== undefined) {
    paintBanner(c, { text: face.banner, k, look })
  }

  c.restore()
}

function paintBanner(c: CanvasRenderingContext2D, at: LookAt & { readonly text: string }): void {
  const { k, look } = at
  const { width: w } = c.canvas

  c.fillStyle = look.banner
  c.beginPath()
  c.roundRect(14 * k, 10 * k, w - 28 * k, 34 * k, 12 * k)
  c.fill()
  c.fillStyle = look.bannerInk
  c.font = `600 ${15 * k}px ${FONT}`
  c.textAlign = 'left'
  c.fillText(at.text, 28 * k, 27.5 * k, w - 60 * k)
}

interface LookAt {
  readonly k: number
  readonly look: StandByLook
}

function paintIndexView(c: CanvasRenderingContext2D, face: StandByView, at: LookAt): void {
  const { k, look } = at
  const r = 56 * k

  disc(c, { x: 66 * k, y: 82 * k, r, colour: look.well })
  dialTicks(c, {
    x: 66 * k,
    y: 82 * k,
    from: r - 9 * k,
    to: r - 3 * k,
    colour: look.tick,
    unit: k,
  })
  hands(c, {
    x: 66 * k,
    y: 82 * k,
    r,
    minute: face.minute,
    colour: look.ink,
    unit: k,
    look: STANDBY_HANDS,
  })

  const { index } = face

  if (index === undefined) {
    return
  }

  c.fillStyle = look.well
  c.beginPath()
  c.roundRect(134 * k, 24 * k, 114 * k, 116 * k, 14 * k)
  c.fill()
  c.textAlign = 'left'
  c.fillStyle = look.dim
  c.font = `600 ${15 * k}px ${FONT}`
  c.fillText(index.label, 146 * k, 48 * k, 96 * k)
  c.fillStyle = look.ink
  c.font = `700 ${25 * k}px ${FONT}`
  c.fillText(index.level, 146 * k, 84 * k, 92 * k)
  c.fillStyle = look.move ?? toneColour(index.move.tone)
  c.font = `700 ${18 * k}px ${FONT}`
  c.fillText(index.move.move, 146 * k, 116 * k, 92 * k)
}

// The flow view: a slow gradient whose soft blobs drift with the face's seconds, the time under it.
function paintFlowView(c: CanvasRenderingContext2D, face: StandByView, at: LookAt): void {
  const { k, look } = at
  const { width: w, height: h } = c.canvas
  const ground = c.createLinearGradient(0, 0, w, h)

  ground.addColorStop(0, look.flowFrom)
  ground.addColorStop(1, look.flowTo)
  c.fillStyle = ground
  c.fillRect(0, 0, w, h)

  const t = face.flowSeconds

  for (const [colour, bx, by, rate] of look.blobs) {
    const px =
      w * (bx + FLOW_DRIFT.x * Math.sin(t * FLOW_DRIFT.xRate * rate + bx * FLOW_DRIFT.xPhase))
    const py =
      h * (by + FLOW_DRIFT.y * Math.cos(t * FLOW_DRIFT.yRate * rate + by * FLOW_DRIFT.yPhase))
    const glow = c.createRadialGradient(px, py, 0, px, py, w * 0.42)

    glow.addColorStop(0, colour)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    c.fillStyle = glow
    c.fillRect(0, 0, w, h)
  }

  c.textAlign = 'center'
  c.fillStyle = look.ink
  c.font = `600 ${26 * k}px ${FONT}`
  c.fillText(face.time, w / 2, h - 26 * k)
}

function toneColour(tone: Tone): string {
  if (tone === 'flat') {
    return TAPE.flat
  }

  return stampToneOf(tone === 'up' ? 'buy' : 'reduce')
}

function disc(
  c: CanvasRenderingContext2D,
  at: { readonly x: number; readonly y: number; readonly r: number; readonly colour: string }
): void {
  c.fillStyle = at.colour
  c.beginPath()
  c.arc(at.x, at.y, at.r, 0, FULL_TURN)
  c.fill()
}

type HandLook = typeof CLOCK_HANDS | typeof STANDBY_HANDS

interface Dial {
  readonly x: number
  readonly y: number
  readonly colour: string
  readonly unit: number
}

function dialTicks(
  c: CanvasRenderingContext2D,
  dial: Dial & { readonly from: number; readonly to: number }
): void {
  c.strokeStyle = dial.colour
  c.lineCap = 'round'

  for (let i = 0; i < TICKS; i++) {
    const a = (i * FULL_TURN) / TICKS

    c.lineWidth = (i % 3 === 0 ? 5 : 3) * dial.unit
    c.beginPath()
    c.moveTo(dial.x + Math.sin(a) * dial.from, dial.y - Math.cos(a) * dial.from)
    c.lineTo(dial.x + Math.sin(a) * dial.to, dial.y - Math.cos(a) * dial.to)
    c.stroke()
  }
}

function hands(
  c: CanvasRenderingContext2D,
  dial: Dial & { readonly r: number; readonly minute: number; readonly look: HandLook }
): void {
  const { look } = dial
  const hour = (dial.minute / MINUTES_PER_HOUR) % HOURS_ON_DIAL
  const minute = dial.minute % MINUTES_PER_HOUR

  c.strokeStyle = dial.colour
  c.lineCap = 'round'
  hand(c, dial, {
    angle: (hour / HOURS_ON_DIAL) * FULL_TURN,
    length: dial.r * look.hour[0],
    width: look.hour[1],
  })
  hand(c, dial, {
    angle: (minute / MINUTES_PER_HOUR) * FULL_TURN,
    length: dial.r * look.minute[0],
    width: look.minute[1],
  })
}

function hand(
  c: CanvasRenderingContext2D,
  dial: Dial,
  spec: { readonly angle: number; readonly length: number; readonly width: number }
): void {
  c.lineWidth = spec.width * dial.unit
  c.beginPath()
  c.moveTo(dial.x, dial.y)
  c.lineTo(dial.x + Math.sin(spec.angle) * spec.length, dial.y - Math.cos(spec.angle) * spec.length)
  c.stroke()
}

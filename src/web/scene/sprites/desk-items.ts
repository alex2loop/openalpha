import type { CalendarView, DeskItemsView, MonitorState, Rect } from '@/web/scene/types'
import { zeroCanvas } from '@/web/scene/renderer'
import { paintTrace } from '@/web/scene/sprites/desk-trace'
import { FONT } from '@/web/scene/sprites/face-text'
import { OUTLINE, PALETTE } from '@/web/scene/sprites/palette'
import { DESK_PROPS, type DeskProp, type DeskPropType } from '@/web/scene/world/desk-props'
import { createRng, seedOf } from '@/web/scene/world/rng'
import { tr } from '@/web/text/tr'

/** The atlas every desk face is painted on, in canvas px. */
export const DESK_ATLAS = Object.freeze({ w: 512, h: 256 })

type FaceCell =
  | 'candles'
  | 'line'
  | 'tabs-1'
  | 'tabs-2'
  | 'checklist'
  | 'calendar'
  | 'photo'
  | 'phone'

// A monitor's bezel, also the edge a tab strip leaves round a monitor it covers.
const BEZEL_PX = 5
const CELLS: Readonly<Record<FaceCell, Rect>> = Object.freeze({
  candles: { x: 0, y: 0, w: 128, h: 80 },
  line: { x: 128, y: 0, w: 128, h: 80 },
  'tabs-1': { x: 256, y: 0, w: 128, h: 80 },
  'tabs-2': { x: 384, y: 0, w: 128, h: 80 },
  checklist: { x: 0, y: 88, w: 112, h: 128 },
  calendar: { x: 112, y: 88, w: 96, h: 120 },
  photo: { x: 240, y: 88, w: 96, h: 72 },
  phone: { x: 336, y: 88, w: 48, h: 96 },
})
const TYPE_CELLS: Readonly<Partial<Record<DeskPropType, FaceCell>>> = Object.freeze({
  'monitor-candles': 'candles',
  'monitor-line': 'line',
  checklist: 'checklist',
  photo: 'photo',
  phone: 'phone',
})
const TAB_CELLS: readonly FaceCell[] = ['tabs-1', 'tabs-2']
const TAB_ROWS = DESK_PROPS.filter((row) => row.type === 'tabs')
const SCREEN = Object.freeze({
  bezel: '#2A2F3F',
  live: '#10142A',
  off: '#14161F',
  grid: '#2C3250',
  rest: '#7C86A8',
  saver: '#0B0F22',
  saverDots: ['#5E6CFF', '#B07CFF', '#4FD1C5'],
})
const TABS = Object.freeze({
  count: 12,
  active: 4,
  strip: '#222633',
  tab: '#3A4056',
  activeTab: '#F4F6FB',
  title: '#6C7390',
  activeTitle: '#8A90A6',
  icons: ['#7DA7F2', '#F2B26B', '#7FD1A0', '#E58FB0', '#B7A2F0', '#F2D36B'],
})
const CHECKLIST = Object.freeze({
  head: '#D8514B',
  box: '#8E8497',
  line: '#B7BBD0',
  tick: '#2E9E57',
})
const CHECK_ROWS = 6
const TICKED_ROWS = 4
const PHOTO = Object.freeze({ frame: '#D9B98F', sky: '#BFE0F2', sun: '#F6D69B', hill: '#B9D9B5' })
const PHONE = Object.freeze({ dark: '#0B0D14', lit: '#1B2442', alert: '#FF6259', card: '#8FA3E8' })
const CALENDAR = Object.freeze({
  page: '#FBF9F3',
  head: '#D8514B',
  headInk: '#FFFFFF',
  ink: '#5A5F73',
  dot: '#B7BBD0',
  headH: 22,
  rows: 6,
  top: 28,
})
const WEEK_DAYS = 7

/** The atlas cell the team floor's calendar is cut from. */
export const CALENDAR_CELL: Rect = CELLS.calendar

/** The atlas cell a piece's face is cut from; a tab strip takes its cell inside the bezel. */
export function deskFaceCellOf(row: DeskProp): Rect | undefined {
  const cell = cellOf(row)

  if (cell === undefined) {
    return undefined
  }

  return row.type === 'tabs' ? insetOf(CELLS[cell], BEZEL_PX) : CELLS[cell]
}

function cellOf(row: DeskProp): FaceCell | undefined {
  return row.type === 'tabs' ? TAB_CELLS[TAB_ROWS.indexOf(row)] : TYPE_CELLS[row.type]
}

/** The desk faces' one canvas, repainted only when what they show or the detail changes. */
export interface DeskAtlas {
  readonly canvas: HTMLCanvasElement
  /** True when it was repainted. */
  sync(view: DeskItemsView, detail: number, calendar: CalendarView | undefined): boolean
  release(): void
}

export function createDeskAtlas(): DeskAtlas {
  const canvas = document.createElement('canvas')
  let painted: { signature: number; isFine: boolean; day: string | undefined } | undefined

  return {
    canvas,
    sync(view, detail, calendar) {
      const isFine = detail >= 1
      const day = calendar?.day

      if (
        painted?.signature === view.signature &&
        painted.isFine === isFine &&
        painted.day === day
      ) {
        return false
      }

      painted = { signature: view.signature, isFine, day }
      paintAtlas(canvas, { view, isFine, day })

      return true
    },
    release() {
      zeroCanvas(canvas)
      painted = undefined
    },
  }
}

function paintAtlas(
  canvas: HTMLCanvasElement,
  at: { readonly view: DeskItemsView; readonly isFine: boolean; readonly day: string | undefined }
): void {
  const { view, isFine, day } = at

  canvas.width = DESK_ATLAS.w
  canvas.height = DESK_ATLAS.h

  const c = canvas.getContext('2d')

  if (c === null) {
    return
  }

  c.textBaseline = 'middle'

  if (day !== undefined) {
    paintCalendar(c, { cell: CELLS.calendar, day, isFine })
  }

  DESK_PROPS.forEach((row, seed) => {
    const cell = cellOf(row)

    if (cell !== undefined) {
      paintFace(c, { row, cell: CELLS[cell], view, isFine, seed })
    }
  })
}

interface FaceJob {
  readonly row: DeskProp
  readonly cell: Rect
  readonly view: DeskItemsView
  readonly isFine: boolean
  readonly seed: number
}

// A tab strip shows only while its owner does not work; the work screen shows then.
function paintFace(c: CanvasRenderingContext2D, job: FaceJob): void {
  const { row, cell, view, isFine } = job
  const state = view.monitors.get(row.owner)

  switch (row.type) {
    case 'monitor-candles':
    case 'monitor-line':
      paintMonitor(c, { ...job, state: state ?? sessionFaceOf(view) })
      return
    case 'tabs':
      if (state !== undefined) {
        paintTabs(c, { ...job, state })
      }
      return
    case 'checklist':
      paintChecklist(c, cell, isFine)
      return
    case 'photo':
      paintPhoto(c, cell)
      return
    case 'phone':
      paintPhone(c, cell, view.isAlertOn)
      return
    default:
      return
  }
}

// A desk's own monitors stay on while their owner works at them.
function sessionFaceOf(view: DeskItemsView): MonitorState {
  return view.session === 'open' ? 'live' : 'rest'
}

interface ScreenJob extends FaceJob {
  readonly state: MonitorState
}

function paintMonitor(c: CanvasRenderingContext2D, job: ScreenJob): void {
  const { cell } = job
  const inner = insetOf(cell, BEZEL_PX)

  c.fillStyle = SCREEN.bezel
  c.fillRect(cell.x, cell.y, cell.w, cell.h)

  if (job.state === 'saver') {
    paintSaver(c, inner, job)
    return
  }

  c.fillStyle = job.state === 'off' ? SCREEN.off : SCREEN.live
  c.fillRect(inner.x, inner.y, inner.w, inner.h)

  if (job.state === 'off') {
    return
  }

  const isRest = job.state === 'rest'
  const { trace } = job.view

  if (trace === undefined) {
    paintBaseline(c, inner, isRest)
  } else {
    paintTrace(c, inner, {
      trace,
      kind: job.row.type === 'monitor-candles' ? 'candles' : 'line',
      isRest,
      isFine: job.isFine,
    })
  }

  if (isRest && job.isFine) {
    const words = tr(
      job.view.session === 'break' ? 'ui.office.desks.break' : 'ui.office.desks.shut'
    )

    c.font = `700 9px ${FONT}`
    c.fillStyle = SCREEN.rest
    c.textAlign = 'left'
    c.fillText(words, inner.x + 6, inner.y + inner.h - 9, inner.w - 12)
  }
}

// With no index line to draw, a dashed baseline across the lit screen.
function paintBaseline(c: CanvasRenderingContext2D, inner: Rect, isRest: boolean): void {
  const baseY = inner.y + inner.h * 0.6

  c.strokeStyle = isRest ? SCREEN.rest : SCREEN.grid
  c.lineWidth = 1
  c.setLineDash([3, 3])
  c.beginPath()
  c.moveTo(inner.x + 8, baseY)
  c.lineTo(inner.x + inner.w - 6, baseY)
  c.stroke()
  c.setLineDash([])
}

// Three soft dots drifting a step every saver step.
function paintSaver(c: CanvasRenderingContext2D, area: Rect, job: ScreenJob): void {
  const step = job.view.saverStep

  c.fillStyle = SCREEN.saver
  c.fillRect(area.x, area.y, area.w, area.h)
  c.globalAlpha = 0.75
  SCREEN.saverDots.forEach((color, i) => {
    const x = area.x + area.w * (0.5 + 0.34 * Math.sin(step * 0.7 + i * 2.1 + job.seed))
    const y = area.y + area.h * (0.5 + 0.3 * Math.cos(step * 0.5 + i * 1.7 + job.seed * 2))

    c.fillStyle = color
    c.beginPath()
    c.arc(x, y, area.h * 0.15, 0, Math.PI * 2)
    c.fill()
  })
  c.globalAlpha = 1
}

// A browser strip of a dozen open tabs along the top of the monitor it covers; the rest stays
// clear, so the monitor's own glow shows. At an empty desk the whole face is a screensaver.
function paintTabs(c: CanvasRenderingContext2D, job: ScreenJob): void {
  const area = insetOf(job.cell, BEZEL_PX)

  if (job.state === 'saver') {
    paintSaver(c, area, { ...job, seed: job.seed + BEZEL_PX })
    return
  }

  if (job.state === 'off') {
    return
  }

  const stripH = 15
  const tabW = (area.w - 4) / TABS.count
  const rng = createRng(seedOf('desk-tabs', String(job.seed)))

  c.fillStyle = TABS.strip
  c.fillRect(area.x, area.y, area.w, stripH)

  for (let i = 0; i < TABS.count; i++) {
    const x = area.x + 2 + i * tabW
    const isActive = i === TABS.active

    c.fillStyle = isActive ? TABS.activeTab : TABS.tab
    c.fillRect(x, area.y + 3, tabW - 0.8, stripH - 3)
    c.fillStyle = TABS.icons[Math.floor(rng.next() * TABS.icons.length)] ?? TABS.tab
    c.fillRect(x + 1.2, area.y + 5.4, 3, 3)

    if (job.isFine) {
      c.fillStyle = isActive ? TABS.activeTitle : TABS.title
      c.fillRect(x + 5, area.y + 6, Math.max(2, tabW - 8.4 - rng.next() * 3), 1.6)
    }
  }
}

function paintChecklist(c: CanvasRenderingContext2D, cell: Rect, isFine: boolean): void {
  const { x, y, w, h } = cell

  c.fillStyle = PALETTE.paper
  c.fillRect(x, y, w, h)
  c.fillStyle = CHECKLIST.head
  c.fillRect(x, y, w, 18)
  c.fillStyle = PALETTE.paper

  if (isFine) {
    c.font = `700 11px ${FONT}`
    c.textAlign = 'left'
    c.fillText(tr('ui.office.desks.checklist'), x + 7, y + 9.5, w - 14)
  } else {
    c.fillRect(x + 7, y + 7, 52, 4)
  }

  for (let i = 0; i < CHECK_ROWS; i++) {
    const rowY = y + 28 + i * 16

    c.strokeStyle = CHECKLIST.box
    c.lineWidth = 1.4
    c.strokeRect(x + 8, rowY, 9, 9)
    c.fillStyle = CHECKLIST.line
    c.fillRect(x + 24, rowY + 3, 50 + ((i * 17) % 30), 3)

    if (i < TICKED_ROWS) {
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

// A framed holiday snap: sky, sun, a hill and two people.
function paintPhoto(c: CanvasRenderingContext2D, cell: Rect): void {
  const { x, y, w, h } = cell

  c.fillStyle = PHOTO.frame
  c.fillRect(x, y, w, h)
  c.fillStyle = PHOTO.sky
  c.fillRect(x + 7, y + 7, w - 14, h - 14)
  c.fillStyle = PHOTO.sun
  c.beginPath()
  c.arc(x + w * 0.7, y + h * 0.34, 8, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = PHOTO.hill
  c.beginPath()
  c.moveTo(x + 7, y + h - 7)
  c.quadraticCurveTo(x + w * 0.4, y + h * 0.42, x + w - 7, y + h - 7)
  c.closePath()
  c.fill()
  c.fillStyle = OUTLINE

  for (const share of [0.38, 0.5]) {
    c.beginPath()
    c.arc(x + w * share, y + h * 0.62, 3, 0, Math.PI * 2)
    c.fill()
    c.fillRect(x + w * share - 2.6, y + h * 0.62 + 3, 5.2, 9)
  }
}

// The alert desk's phone lights with an alert card while an alert is unread.
function paintPhone(c: CanvasRenderingContext2D, cell: Rect, isLit: boolean): void {
  const { x, y, w, h } = cell

  c.fillStyle = isLit ? PHONE.lit : PHONE.dark
  c.fillRect(x, y, w, h)

  if (!isLit) {
    return
  }

  c.fillStyle = PHONE.alert
  c.fillRect(x + 5, y + 22, w - 10, 16)
  c.fillStyle = PALETTE.paper
  c.fillRect(x + 9, y + 28, w - 18, 3)
  c.fillStyle = PHONE.card
  c.fillRect(x + 5, y + 44, w - 10, 12)
}

// A month page: the month's number on a red band, each day a dot (its number from room zoom), the
// ex-dividend day circled.
function paintCalendar(
  c: CanvasRenderingContext2D,
  at: { readonly cell: Rect; readonly day: string; readonly isFine: boolean }
): void {
  const { cell } = at
  const [year = 0, month = 1, date = 1] = at.day.split('-').map(Number)
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const colW = cell.w / WEEK_DAYS
  const rowH = (cell.h - CALENDAR.top - 4) / CALENDAR.rows

  c.fillStyle = CALENDAR.page
  c.fillRect(cell.x, cell.y, cell.w, cell.h)
  c.fillStyle = CALENDAR.head
  c.fillRect(cell.x, cell.y, cell.w, CALENDAR.headH)
  c.fillStyle = CALENDAR.headInk
  c.font = `700 14px ${FONT}`
  c.textAlign = 'center'
  c.fillText(String(month), cell.x + cell.w / 2, cell.y + CALENDAR.headH / 2)
  c.font = `600 9px ${FONT}`

  for (let day = 1; day <= length; day++) {
    const slot = first + day - 1
    const x = cell.x + colW * ((slot % WEEK_DAYS) + 0.5)
    const y = cell.y + CALENDAR.top + rowH * (Math.floor(slot / WEEK_DAYS) + 0.5)

    c.fillStyle = CALENDAR.ink

    if (at.isFine) {
      c.fillText(String(day), x, y)
    } else {
      c.fillStyle = CALENDAR.dot
      c.fillRect(x - 1.5, y - 1.5, 3, 3)
    }

    if (day === date) {
      c.strokeStyle = CALENDAR.head
      c.lineWidth = 2
      c.beginPath()
      c.arc(x, y, colW * 0.52, 0, Math.PI * 2)
      c.stroke()
    }
  }
}

function insetOf(rect: Rect, by: number): Rect {
  return { x: rect.x + by, y: rect.y + by, w: rect.w - by * 2, h: rect.h - by * 2 }
}

import type { AgendaModel, AgendaRow } from '@/web/scene/data/agenda'
import type { Size } from '@/web/scene/types'
import type { PropDef } from '@/web/scene/world/props'
import { pluralKey } from '@/i18n'
import { zeroCanvas } from '@/web/scene/renderer'
import { formatDuration } from '@/web/text/time'
import { MS_PER_MINUTE } from '@/web/text/time-units'
import { tr } from '@/web/text/tr'

// Text cached at the first of these canvas pixels per world pixel that covers the zoom.
const CACHE_STEPS = [2, 4, 8] as const
const FINEST_STEP = 16
// A line of a screen's text is about a tenth of its height; under this many CSS px it cannot be
// read, and the screen shows only the time and the label.
const MIN_TEXT_PX = 9
const LINE_SHARE = 0.1
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
const CLIP_MARK = '...'
const PANEL = '#171A2B'
const PANEL_LINE = '#2C3250'
const DIM = '#6C6D82'
const HEAD = '#9C9DB2'
const HOT = '#FFD166'
const HOT_BAND = '#2A3158'
const TEXT = '#EEF0FA'
const ROW_COLORS: Readonly<Record<AgendaRow['state'], string>> = Object.freeze({
  next: HOT,
  done: DIM,
  todo: TEXT,
})
const CARD_VARIANT = 1
const LIST_ROWS = 4

interface CachedScreen {
  readonly canvas: HTMLCanvasElement
  key: string
}

/** The lobby's two agenda screens, each a canvas redrawn only when the agenda or the zoom step
 *  changes, then blitted onto the floor. */
export interface ScreenCache {
  drawAgenda(
    g: CanvasRenderingContext2D,
    prop: PropDef,
    view: { readonly model: AgendaModel; readonly scale: number }
  ): void
  release(): void
}

export function createScreenCache(): ScreenCache {
  const screens = new Map<string, CachedScreen>()

  return {
    drawAgenda(g, prop, view) {
      const { x, y, w, h } = prop.draw
      const isTiny = h * LINE_SHARE * view.scale < MIN_TEXT_PX
      const step = CACHE_STEPS.find((candidate) => candidate >= view.scale) ?? FINEST_STEP
      const key = `${view.model.sig}|${step}|${isTiny}`
      const screen = screens.get(prop.id) ?? { canvas: document.createElement('canvas'), key: '' }

      screens.set(prop.id, screen)

      if (screen.key !== key) {
        repaint(screen.canvas, { prop, model: view.model, step, isTiny })
        screen.key = key
      }

      g.drawImage(screen.canvas, x, y, w, h)
    },
    release() {
      for (const screen of screens.values()) {
        zeroCanvas(screen.canvas)
      }

      screens.clear()
    },
  }
}

interface PaintJob {
  readonly prop: PropDef
  readonly model: AgendaModel
  readonly step: number
  readonly isTiny: boolean
}

function repaint(canvas: HTMLCanvasElement, job: PaintJob): void {
  const { w, h } = job.prop.draw
  const c = canvas.getContext('2d')

  canvas.width = Math.ceil(w * job.step)
  canvas.height = Math.ceil(h * job.step)

  if (c === null) {
    return
  }

  c.scale(job.step, job.step)
  c.fillStyle = PANEL
  c.fillRect(0, 0, w, h)
  c.strokeStyle = PANEL_LINE
  c.lineWidth = Math.max(1, h * 0.02)
  c.strokeRect(0.5, 0.5, w - 1, h - 1)
  c.textBaseline = 'middle'

  const size = { w, h }

  if (job.prop.variant === CARD_VARIANT) {
    paintCard(c, size, job)
  } else {
    paintList(c, size, job)
  }
}

// The headline screen: the next row big, its countdown, and how many price alerts are watched.
function paintCard(c: CanvasRenderingContext2D, size: Size, job: PaintJob): void {
  const { w, h } = size
  const next = job.model.next
  const pad = h * 0.09
  const inner = w - pad * 2

  if (next === undefined) {
    writeAll(c, [
      [
        tr('ui.office.agenda.empty'),
        w / 2,
        h / 2,
        h * 0.13,
        { color: HEAD, align: 'center', maxW: w - 8 },
      ],
    ])
    return
  }

  if (job.isTiny) {
    writeAll(c, [
      [next.time, w / 2, h * 0.4, h * 0.4, { color: HOT, align: 'center', weight: 700 }],
      [next.label, w / 2, h * 0.78, h * 0.2, { color: TEXT, align: 'center', maxW: w - 8 }],
    ])
    return
  }

  const watching = job.model.watching

  writeAll(c, [
    [tr('ui.office.agenda.next'), pad, h * 0.16, h * 0.115, { color: HEAD }],
    [countdownOf(job.model), w - pad, h * 0.16, h * 0.115, { color: HEAD, align: 'right' }],
    [next.time, pad, h * 0.43, h * 0.3, { color: HOT, weight: 700, maxW: inner }],
    [next.label, pad, h * 0.69, h * 0.15, { color: TEXT, weight: 600, maxW: inner }],
    ...(watching === undefined
      ? []
      : [
          [watchingLine(watching), pad, h * 0.89, h * 0.105, { color: HEAD, maxW: inner }] as const,
        ]),
  ])
}

// The list screen: a title and four rows, the next highlighted, the finished ones dimmed.
function paintList(c: CanvasRenderingContext2D, size: Size, job: PaintJob): void {
  if (job.isTiny) {
    paintTinyList(c, size, job.model.next)
    return
  }

  const { w, h } = size
  const { model } = job
  const pad = h * 0.08
  const head = h * 0.19
  const rowH = (h - pad * 2 - head) / LIST_ROWS
  const title = model.closedLine ?? tr('ui.office.agenda.title')
  const left = tr(pluralKey(model.remaining, 'ui.office.agenda.leftOne', 'ui.office.agenda.left'), {
    count: model.remaining,
  })

  writeAll(c, [
    [title, pad, pad + head / 2, head * 0.55, { color: HEAD, weight: 600, maxW: w * 0.62 }],
    [left, w - pad, pad + head / 2, head * 0.5, { color: HEAD, align: 'right' }],
  ])

  if (model.rows.length === 0) {
    const empty = tr('ui.office.agenda.empty')

    write(c, [empty, pad, pad + head + rowH, rowH * 0.55, { color: DIM, maxW: w - pad * 2 }])
    return
  }

  for (const [index, row] of model.rows.entries()) {
    paintRow(c, { row, y: pad + head + rowH * (index + 0.5), rowH, w, pad })
  }
}

// Too small to read four rows: the next time and its label.
function paintTinyList(c: CanvasRenderingContext2D, size: Size, next: AgendaRow | undefined): void {
  const { w, h } = size
  const headline =
    next === undefined
      ? tr('ui.office.agenda.empty')
      : tr('ui.office.agenda.nextAt', { time: next.time })
  const centred = { align: 'center', maxW: w - 8 } as const

  writeAll(c, [
    [headline, w / 2, h * 0.36, h * 0.22, { ...centred, color: TEXT, weight: 700 }],
    [next?.label ?? '', w / 2, h * 0.68, h * 0.2, { ...centred, color: HEAD }],
  ])
}

function paintRow(
  c: CanvasRenderingContext2D,
  spec: {
    readonly row: AgendaRow
    readonly y: number
    readonly rowH: number
    readonly w: number
    readonly pad: number
  }
): void {
  const { row, y, rowH, w, pad } = spec
  const isNext = row.state === 'next'
  const color = ROW_COLORS[row.state]
  const size = rowH * 0.6

  if (isNext) {
    c.fillStyle = HOT_BAND
    c.fillRect(pad / 2, y - rowH / 2, w - pad, rowH)
    c.fillStyle = HOT
    c.fillRect(pad / 2, y - rowH / 2, Math.max(1, rowH * 0.12), rowH)
  }

  const timeW = write(c, [row.time, pad * 1.2, y, size, { color, weight: isNext ? 700 : 600 }])
  const gap = size * 0.6

  write(c, [
    row.label,
    pad * 1.2 + timeW + gap,
    y,
    size,
    { color, weight: isNext ? 700 : 500, maxW: w - pad * 2.4 - timeW - gap },
  ])
}

function countdownOf(model: AgendaModel): string {
  const leftMs = Math.max(
    MS_PER_MINUTE,
    Math.ceil((model.untilNextMs ?? 0) / MS_PER_MINUTE) * MS_PER_MINUTE
  )

  return tr('ui.office.bell.countdown', { time: formatDuration(leftMs) })
}

function watchingLine(count: number): string {
  return tr(pluralKey(count, 'ui.office.agenda.watchingOne', 'ui.office.agenda.watching'), {
    count,
  })
}

interface LineStyle {
  readonly color: string
  readonly align?: CanvasTextAlign
  readonly weight?: number
  readonly maxW?: number
}

/** Text, x, y and font size in world px, then how it looks. */
type Line = readonly [string, number, number, number, LineStyle]

function writeAll(c: CanvasRenderingContext2D, lines: readonly Line[]): void {
  for (const line of lines) {
    write(c, line)
  }
}

// Writes one line, cut with a trailing mark when it does not fit; returns the width it took.
function write(c: CanvasRenderingContext2D, line: Line): number {
  const [raw, x, y, size, style] = line

  c.font = `${style.weight ?? 500} ${size}px ${FONT}`
  c.fillStyle = style.color
  c.textAlign = style.align ?? 'left'

  const text = style.maxW === undefined ? raw : clip(c, raw, style.maxW)

  c.fillText(text, x, y)

  return c.measureText(text).width
}

function clip(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) {
    return text
  }

  let length = text.length

  while (length > 1 && c.measureText(`${text.slice(0, length)}${CLIP_MARK}`).width > maxW) {
    length--
  }

  return `${text.slice(0, length)}${CLIP_MARK}`
}

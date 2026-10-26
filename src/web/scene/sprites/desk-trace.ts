import type { DeskTrace, Rect } from '@/web/scene/types'
import { stampToneOf } from '@/web/scene/sprites/palette'
import { FONT } from '@/web/scene/sprites/screens'
import { formatSignedPercent, toneOfPercent } from '@/web/text/figures'

/** Which face a monitor draws the index on: a line, or candles. */
type TraceKind = 'line' | 'candles'

// The chart keeps the latest points only, so a long day still reads; candles group them.
const MAX_POINTS = 60
const CANDLES = 9
const HEAD_PX = 14
const CHART_INSET = Object.freeze({ left: 10, right: 4, bottom: 8 })
const INK = Object.freeze({ label: '#9FB0FF', grid: '#2C3250', rest: '#7C86A8' })
const HEAD_FONT_PX = 9
const BAR = Object.freeze({ w: 18, h: 3, pad: 4 })
const DOT_R = 2.4

/** The home index drawn in a monitor's `area`: its name and move above, then the day's levels as
 *  a line or as candles against the previous close (dashed). A grey `isRest` screen draws it all
 *  in one grey; from the room zoom (`isFine`) the name, the move and the wicks show in full. */
export function paintTrace(
  c: CanvasRenderingContext2D,
  area: Rect,
  job: {
    readonly trace: DeskTrace
    readonly kind: TraceKind
    readonly isRest: boolean
    readonly isFine: boolean
  }
): void {
  const { trace } = job
  const tone = toneOfPercent(trace.changePct)
  const colour =
    job.isRest || tone === 'flat' ? INK.rest : stampToneOf(tone === 'up' ? 'buy' : 'reduce')
  const points = trace.line.slice(-MAX_POINTS)
  const chart: Rect = {
    x: area.x + CHART_INSET.left,
    y: area.y + HEAD_PX,
    w: area.w - CHART_INSET.left - CHART_INSET.right,
    h: area.h - HEAD_PX - CHART_INSET.bottom,
  }
  const lo = Math.min(trace.close, ...points)
  const hi = Math.max(trace.close, ...points)
  const yOf = (level: number): number =>
    chart.y + chart.h - ((level - lo) / (hi - lo || 1)) * chart.h

  paintHead(c, area, { trace, colour, isFine: job.isFine })
  c.strokeStyle = INK.grid
  c.lineWidth = 1
  c.setLineDash([3, 3])
  c.beginPath()
  c.moveTo(chart.x, yOf(trace.close))
  c.lineTo(chart.x + chart.w, yOf(trace.close))
  c.stroke()
  c.setLineDash([])

  if (job.kind === 'line') {
    paintLine(c, { chart, points, colour, yOf, hasDot: !job.isRest })
  } else {
    paintCandles(c, { chart, points, colour, yOf, isRest: job.isRest, isFine: job.isFine })
  }
}

// The index's name on the left and its move on the right; two bars before the room zoom.
function paintHead(
  c: CanvasRenderingContext2D,
  area: Rect,
  head: { readonly trace: DeskTrace; readonly colour: string; readonly isFine: boolean }
): void {
  if (!head.isFine) {
    c.fillStyle = INK.label
    c.fillRect(area.x + BAR.pad, area.y + BAR.pad, BAR.w, BAR.h)
    c.fillStyle = head.colour
    c.fillRect(area.x + area.w - BAR.pad - BAR.w, area.y + BAR.pad, BAR.w, BAR.h)

    return
  }

  c.font = `700 ${HEAD_FONT_PX}px ${FONT}`
  c.textBaseline = 'top'
  c.fillStyle = INK.label
  c.textAlign = 'left'
  c.fillText(head.trace.label, area.x + BAR.pad, area.y + 3)
  c.fillStyle = head.colour
  c.textAlign = 'right'
  c.fillText(formatSignedPercent(head.trace.changePct), area.x + area.w - BAR.pad, area.y + 3)
  c.textBaseline = 'middle'
}

interface Chart {
  readonly chart: Rect
  readonly points: readonly number[]
  readonly colour: string
  readonly yOf: (level: number) => number
}

function xOf(chart: Rect, index: number, count: number): number {
  return chart.x + (count < 2 ? 0 : (index / (count - 1)) * chart.w)
}

function paintLine(c: CanvasRenderingContext2D, job: Chart & { readonly hasDot: boolean }): void {
  const { points } = job

  c.strokeStyle = job.colour
  c.lineWidth = 2
  c.lineJoin = 'round'
  c.beginPath()

  for (const [index, level] of points.entries()) {
    const x = xOf(job.chart, index, points.length)

    if (index === 0) {
      c.moveTo(x, job.yOf(level))
    } else {
      c.lineTo(x, job.yOf(level))
    }
  }

  c.stroke()

  const last = points.at(-1)

  if (job.hasDot && last !== undefined) {
    c.fillStyle = job.colour
    c.beginPath()
    c.arc(xOf(job.chart, points.length - 1, points.length), job.yOf(last), DOT_R, 0, Math.PI * 2)
    c.fill()
  }
}

// Candles of an equal number of points each; a grey screen is one grey, a live one is up or down
// by each candle's own close against its open.
function paintCandles(
  c: CanvasRenderingContext2D,
  job: Chart & { readonly isRest: boolean; readonly isFine: boolean }
): void {
  const { points, chart } = job
  const group = Math.max(1, Math.ceil(points.length / CANDLES))
  const width = (chart.w / Math.max(1, Math.ceil(points.length / group))) * 0.62

  for (let from = 0; from < points.length; from += group) {
    const slice = points.slice(from, from + group + 1)
    const open = slice[0] ?? 0
    const close = slice.at(-1) ?? open
    const x = xOf(chart, from + (slice.length - 1) / 2, points.length)
    const colour = job.isRest || close === open ? job.colour : candleColour(close > open)

    c.strokeStyle = colour
    c.fillStyle = colour
    c.lineWidth = 1

    if (job.isFine) {
      c.beginPath()
      c.moveTo(x, job.yOf(Math.max(...slice)))
      c.lineTo(x, job.yOf(Math.min(...slice)))
      c.stroke()
    }

    c.fillRect(
      x - width / 2,
      Math.min(job.yOf(open), job.yOf(close)),
      width,
      Math.max(2, Math.abs(job.yOf(open) - job.yOf(close)))
    )
  }
}

function candleColour(isUp: boolean): string {
  return stampToneOf(isUp ? 'buy' : 'reduce')
}

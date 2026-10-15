import type { RenderContext } from '@/trading/render/format'

/** Box-drawing rather than emoji: a chart is read by where its marks sit, so every glyph has to be
 *  one cell wide on the surfaces that count cells. */
export const LADDER_MARKS = Object.freeze({
  start: '├',
  track: '─',
  at: '●',
  tick: '┼',
  end: '┤',
})

/** A share of the whole and the one level it is read against. The mark is hollow so it stays
 *  visible where it falls inside the filled part. */
export const BAR_MARKS = Object.freeze({
  held: '█',
  half: '▌',
  empty: '░',
  mark: '○',
})

const SPARK_MARKS = Object.freeze(['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const)

/** A chart inside a line of facts or a grid stays short enough to share it; one on its own line has
 *  the room to place its marks twice as finely. */
export const CHART_CELLS = Object.freeze({ fact: 10, line: 20 })

/** One reading between two ends. `from` is always the end that goes against the reader and `to`
 *  the one in their favour, whichever is the larger number: a rate's bearish anchor sits above its
 *  bullish one. */
interface Ladder {
  readonly from: number
  readonly to: number
  readonly at: number
  readonly fromLabel: string
  readonly toLabel: string
  readonly ticks?: readonly number[]
}

/** Shares of the whole, each in [0, 1]. `mark` is the level the row is read against, absent where
 *  the row has none. */
export interface BarShares {
  readonly now: number
  readonly mark?: number
}

function cellAt(fraction: number, cells: number): number {
  return Math.min(cells - 1, Math.round(fraction * (cells - 1)))
}

/** Only the bar. A reading past either end sits outside the bracket rather than on it, so a price
 *  already through its stop never reads as one resting at it. */
function ladderTrack(ladder: Ladder, cells: number): string | undefined {
  const span = ladder.to - ladder.from
  const position = (ladder.at - ladder.from) / span

  if (span === 0 || !Number.isFinite(span) || !Number.isFinite(position)) {
    return undefined
  }

  const ticks = new Set(
    (ladder.ticks ?? []).map((tick) => cellAt((tick - ladder.from) / span, cells))
  )
  const inside = position >= 0 && position <= 1
  const atCell = inside ? cellAt(position, cells) : -1
  const body = Array.from({ length: cells }, (_, cell) => {
    if (cell === atCell) {
      return LADDER_MARKS.at
    }

    return ticks.has(cell) ? LADDER_MARKS.tick : LADDER_MARKS.track
  }).join('')
  const track = `${LADDER_MARKS.start}${body}${LADDER_MARKS.end}`

  if (inside) {
    return track
  }

  return position < 0 ? `${LADDER_MARKS.at}${track}` : `${track}${LADDER_MARKS.at}`
}

/** The ladder with its ends named. Absent where the surface relays text word for word, and where
 *  the ends do not span a range. */
export function renderLadder(
  ladder: Ladder,
  cells: number,
  context: RenderContext
): string | undefined {
  const track = context.charts ? ladderTrack(ladder, cells) : undefined

  return track === undefined ? undefined : `${ladder.fromLabel} ${track} ${ladder.toLabel}`
}

function clampShare(share: number): number {
  return Math.min(Math.max(share, 0), 1)
}

/** Whole cells, then a half cell where the remainder reaches it, so a 2.5% step still shows. */
function barCell(cell: number, held: number): string {
  if (cell < Math.floor(held)) {
    return BAR_MARKS.held
  }

  return cell === Math.floor(held) && !Number.isInteger(held) ? BAR_MARKS.half : BAR_MARKS.empty
}

/** Absent where the surface relays text word for word, and where a share is not a number. */
export function renderBar(
  bar: BarShares,
  cells: number,
  context: RenderContext
): string | undefined {
  const shares = [bar.now, ...(bar.mark === undefined ? [] : [bar.mark])]

  if (!(context.charts && shares.every(Number.isFinite))) {
    return undefined
  }

  const held = Math.round(clampShare(bar.now) * cells * 2) / 2
  const mark =
    bar.mark === undefined ? -1 : Math.min(cells - 1, Math.floor(clampShare(bar.mark) * cells))

  return Array.from({ length: cells }, (_, cell) =>
    cell === mark ? BAR_MARKS.mark : barCell(cell, held)
  ).join('')
}

interface SeriesExtremes {
  readonly trough: number
  readonly peak: number
}

/** The value a bucket of a squeezed series prints: its last one, unless the bucket holds the whole
 *  series' trough or peak, which must survive the squeeze or the deepest drop would vanish. */
function bucketValue(bucket: readonly number[], extremes: SeriesExtremes): number {
  if (bucket.includes(extremes.trough)) {
    return extremes.trough
  }

  return bucket.includes(extremes.peak) ? extremes.peak : (bucket.at(-1) ?? 0)
}

/** Absent where the surface relays text word for word, and where fewer than two values make no
 *  line. */
export function renderSparkline(
  values: readonly number[],
  cells: number,
  context: RenderContext
): string | undefined {
  if (!context.charts || values.length < 2) {
    return undefined
  }

  const width = Math.min(cells, values.length)
  const extremes = { trough: Math.min(...values), peak: Math.max(...values) }
  const sampled = Array.from({ length: width }, (_, cell) =>
    bucketValue(
      values.slice(
        Math.floor((cell * values.length) / width),
        Math.floor(((cell + 1) * values.length) / width)
      ),
      extremes
    )
  )
  const low = Math.min(...sampled)
  const span = Math.max(...sampled) - low
  const top = SPARK_MARKS.length - 1

  return sampled
    .map((value) => SPARK_MARKS[span === 0 ? 0 : Math.round(((value - low) / span) * top)])
    .join('')
}

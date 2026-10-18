import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { BarShares } from '@/trading/render/chart'
import type { RenderContext } from '@/trading/render/format'
import type { ColumnAlign } from '@/trading/render/table'
import { t } from '@/i18n'
import { BAR_MARKS, CHART_CELLS, renderBar } from '@/trading/render/chart'
import { SECTION_ICONS } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR, renderSectionTitle, toFactLines } from '@/trading/render/layout'
import { ABSENT_CELL } from '@/trading/render/number'
import { toTable } from '@/trading/render/table'

/** The column every block leads with. It carries a header in the grid and no label in the stacked
 *  shape, because a reader looking at a segment's name does not need to be told it is one. */
const NAME_COLUMN: SegmentColumn = Object.freeze({
  labelKey: 'trading.render.segment.columnSegment',
  align: 'left',
})

export interface SegmentColumn {
  readonly labelKey: MessageKey
  readonly align: ColumnAlign
}

/** One segment's answers: one entry per declared value column, in that order. `undefined` is a cell
 *  this segment cannot answer - a dash in the grid, and nothing at all on a phone line, because a
 *  narrow line should not spend itself on a dash where a number would be. */
export interface SegmentRow {
  readonly name: string
  readonly cash: boolean
  readonly cells: readonly (string | undefined)[]
  /** Absent where the surface draws no bar for this block. */
  readonly bar?: BarShares
}

export interface SegmentBlock {
  /** The value columns, in order. The first answers "how much" and rides the header line in the
   *  stacked shape; the rest are the ceilings on its detail line. */
  readonly columns: readonly SegmentColumn[]
  readonly rows: readonly SegmentRow[]
  /** Segments the operator switched off, named once under the rows instead of as rows of zeros. */
  readonly disabled: readonly string[]
  /** Segments whose target the operator set by hand. Absent where the surface does not track them;
   *  a pin that re-seeding honours has to be visible, or a target that will not move on a
   *  risk-level change reads as a bug. */
  readonly pinned?: readonly string[]
  /** What the bar's mark means here, stated once under the rows. */
  readonly legend?: MessageKey
}

/** The one place the segment facts are drawn. A grid where the reader has a monospace font, and one
 *  segment per two-line block where they do not - never two segments on one line, so a wrap can only
 *  ever orphan a number under the name it belongs to. */
export function renderSegmentBlock(
  locale: Locale,
  block: SegmentBlock,
  context: RenderContext
): readonly string[] {
  const off = namedSegments(locale, 'trading.render.segment.off', block.disabled)

  if (block.rows.length === 0 && off.length === 0) {
    return []
  }

  return [
    renderSectionTitle(SECTION_ICONS.segments, t(locale, 'trading.render.segment.title')),
    ...bodyLines(locale, block, context),
    ...legendLines(locale, block, context),
    ...namedSegments(locale, 'trading.render.segment.pinned', block.pinned ?? []),
    ...off,
  ]
}

/** Empty for an empty segment list: a grid built from no rows is a header naming columns nothing
 *  fills, while the disabled line under it still stands on its own. */
function bodyLines(locale: Locale, block: SegmentBlock, context: RenderContext): readonly string[] {
  const rows = orderSegments(block.rows)

  if (rows.length === 0) {
    return []
  }

  return context.layout === 'lines'
    ? rows.flatMap((row) => stackedLines(locale, { columns: block.columns, row }, context))
    : gridLines(locale, block.columns, rows)
}

function legendLines(
  locale: Locale,
  block: SegmentBlock,
  context: RenderContext
): readonly string[] {
  const drawn =
    context.charts && context.layout === 'lines' && block.rows.some((row) => row.bar !== undefined)

  return drawn && block.legend !== undefined
    ? [`${INDENT[1]}${t(locale, block.legend, BAR_MARKS)}`]
    : []
}

/** Cash last, because it is what the other segments leave behind. */
function orderSegments(rows: readonly SegmentRow[]): readonly SegmentRow[] {
  return [...rows.filter((row) => !row.cash), ...rows.filter((row) => row.cash)]
}

function gridLines(
  locale: Locale,
  columns: readonly SegmentColumn[],
  rows: readonly SegmentRow[]
): readonly string[] {
  const header = [NAME_COLUMN, ...columns].map((column) => t(locale, column.labelKey))
  const cells = rows.map((row) => [row.name, ...row.cells.map((cell) => cell ?? ABSENT_CELL)])
  const aligns = [NAME_COLUMN.align, ...columns.map((column) => column.align)]

  return toTable([header, ...cells], aligns).map((line) => `${INDENT[1]}${line}`)
}

/** The name and the one number that answers "how much", then the ceilings indented under it. The
 *  detail line is dropped where a segment has no ceilings, which is why cash is one line. */
function stackedLines(
  locale: Locale,
  segment: { readonly columns: readonly SegmentColumn[]; readonly row: SegmentRow },
  context: RenderContext
): readonly string[] {
  const { columns, row } = segment
  const [lead, ...rest] = columns
  const [leadCell, ...restCells] = row.cells
  const head =
    lead === undefined || leadCell === undefined
      ? row.name
      : `${row.name}${INLINE_SEPARATOR}${labelled(locale, lead, leadCell)}`
  const detail = rest.flatMap((column, index) => {
    const cell = restCells[index]

    return cell === undefined ? [] : [labelled(locale, column, cell)]
  })

  const bar = row.bar === undefined ? undefined : renderBar(row.bar, CHART_CELLS.line, context)

  return [
    `${INDENT[1]}${head}`,
    ...(bar === undefined ? [] : [`${INDENT[2]}${bar}`]),
    ...toFactLines(detail, context, 2),
  ]
}

function labelled(locale: Locale, column: SegmentColumn, value: string): string {
  return t(locale, 'trading.render.segment.cell', { label: t(locale, column.labelKey), value })
}

/** A set of segments stated under the rows rather than as a column: both answers are the same shape,
 *  and a column of mostly-empty flags costs every row to tell the reader about two of them. */
function namedSegments(
  locale: Locale,
  key: MessageKey,
  segments: readonly string[]
): readonly string[] {
  if (segments.length === 0) {
    return []
  }

  return [`${INDENT[1]}${t(locale, key, { segments: segments.join(INLINE_SEPARATOR) })}`]
}

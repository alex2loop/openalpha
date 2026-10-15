import type { Locale } from '@/core/types/locale'
import type { CaveatCode } from '@/trading/kernel/caveat'
import type { MarketRef } from '@/trading/kernel/instrument'
import type {
  RefreshAnchor,
  RefreshKindResult,
  RefreshMarketDataResult,
} from '@/trading/kernel/market/refresh'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatInstant } from '@/trading/render/datetime'
import { formatCount, renderDeclaredValue, SECTION_ICONS } from '@/trading/render/format'
import {
  INDENT,
  INLINE_SEPARATOR,
  joinSections,
  renderAsOf,
  renderEmptyLine,
  renderSectionTitle,
} from '@/trading/render/layout'

const COLUMN_GAP = '  '
/** The row carries status and coverage as columns, so the caveats that restate them would read as a
 *  second, separate finding. Every other caveat names its own kind and stands under the market. */
const ROW_STATUS_CODES: ReadonlySet<CaveatCode> = new Set([
  'refresh.scope-empty',
  'refresh.scope-partial',
  'refresh.previous-scope-kept',
])

interface KindRow {
  readonly label: string
  readonly status: string
  readonly coverage: string
  readonly count: string
  readonly unit: string
}

type ColumnWidths = Readonly<Record<'label' | 'status' | 'coverage' | 'count', number>>

/** The dynamic `trading.refresh.*` keys stay compile-checked because both unions are closed and
 *  every combination exists in the catalogs. */
interface RefreshSweep {
  readonly results: readonly RefreshMarketDataResult[]
  /** Markets an unqualified refresh left out because nothing the operator relies on reads them. */
  readonly skipped: readonly MarketRef[]
}

export function renderRefreshText(
  locale: Locale,
  sweep: RefreshSweep,
  context: RenderContext
): string {
  const { results } = sweep
  const skipped = skippedLines(locale, sweep.skipped)

  if (results.length === 0) {
    return skipped.length > 0
      ? joinSections([
          [
            renderSectionTitle(SECTION_ICONS.refresh, t(locale, 'trading.render.refresh.title')),
            ...skipped,
          ],
        ])
      : renderEmptyLine(SECTION_ICONS.refresh, t(locale, 'trading.render.refresh.noMarkets'))
  }

  const markets = results.map((result) => ({
    result,
    rows: result.results.map((kind) => kindRow(locale, kind)),
  }))
  // One measurement for the message: a width taken per market stacks grids whose columns land in
  // different places down the page.
  const widths = columnWidths(markets.flatMap((market) => market.rows))

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.refresh, t(locale, 'trading.render.refresh.title')),
      ...markets.flatMap((market) =>
        marketLines({
          locale,
          context,
          widths,
          ...market,
        })
      ),
      ...skipped,
    ],
  ])
}

function skippedLines(locale: Locale, skipped: readonly MarketRef[]): readonly string[] {
  const [example] = skipped

  if (example === undefined) {
    return []
  }

  const markets = skipped
    .map((market) => renderDeclaredValue(locale, `trading.market.${market}`))
    .join(', ')

  return [
    `${INDENT[1]}${t(locale, 'trading.render.refresh.skipped', { markets, market: example })}`,
  ]
}

interface MarketBlock {
  readonly locale: Locale
  readonly context: RenderContext
  readonly widths: ColumnWidths
  readonly result: RefreshMarketDataResult
  readonly rows: readonly KindRow[]
}

/** Every kind keeps its row, already current or not: its count is what the last pass that fetched
 *  it wrote, which only its own status dates. Notes name their own subject and stand under the
 *  market, which is also where a note belonging to no kind lands. */
function marketLines(block: MarketBlock): readonly string[] {
  const { locale } = block

  return [
    `${INDENT[1]}${marketHeader(locale, block.result)}`,
    ...anchorLines(locale, block.result.anchors, block.context.timezone).map(
      (line) => `${INDENT[2]}${line}`
    ),
    ...block.rows.map((cells) => `${INDENT[2]}${rowLine(locale, cells, block)}`),
    ...noteLines(locale, block.result).map((line) => `${INDENT[2]}${line}`),
  ]
}

/** When the loop fires next for this market, on the operator's own clock. Only the next fire:
 *  the loop reschedules after every tick, so anything past it shifts. Absent where the calendar
 *  named no future anchor, which only an empty registry reaches. */
function anchorLines(
  locale: Locale,
  anchors: readonly RefreshAnchor[],
  timezone: string
): readonly string[] {
  const [next] = anchors

  if (next === undefined) {
    return []
  }

  const time = `${t(locale, `trading.refresh.anchor.${next.kind}`)} ${formatInstant(locale, next.at, timezone)}`

  return [t(locale, 'trading.render.refresh.next', { time })]
}

function rowLine(locale: Locale, cells: KindRow, block: MarketBlock): string {
  return block.context.layout === 'lines'
    ? inlineRow(locale, cells)
    : renderRow(cells, block.widths)
}

/** Count and unit are one cell here and two in the grid: the grid right-aligns the count so the
 *  units line up down the page, which a single chat line has no column to do. */
function inlineRow(locale: Locale, cells: KindRow): string {
  return [
    cells.label,
    cells.status,
    cells.coverage,
    // The template is two placeholders and a space, so an absent count would still join as one.
    cells.count.length === 0
      ? ''
      : t(locale, 'trading.render.refresh.records', { count: cells.count, unit: cells.unit }),
  ]
    .filter((cell) => cell.length > 0)
    .join(INLINE_SEPARATOR)
}

/** The settled day always shows: "already current" answers nothing without the session it is
 *  current through. The run's own duration is the footer's, which states it once for a set of
 *  markets that refreshed concurrently and therefore never sum. */
function marketHeader(locale: Locale, result: RefreshMarketDataResult): string {
  const name = renderDeclaredValue(locale, `trading.market.${result.market}`)

  return `${name}${renderAsOf(locale, result.dataThroughDay)}`
}

/** A kind with no population reports no number: the status is the whole fact, and a bare `0` beside
 *  a unit reads as a measurement that was taken. */
function kindRow(locale: Locale, result: RefreshKindResult): KindRow {
  const label = t(locale, `trading.refresh.kind.${result.kind}`)
  const status = t(locale, `trading.refresh.status.${result.status}`)

  if (result.recordCount === 0) {
    return { label, status, coverage: '', count: '', unit: '' }
  }

  const shortfall = result.successfulTargetCount < result.targetCount

  return {
    label,
    status,
    coverage: shortfall ? coverage(locale, result) : '',
    count: formatCount(locale, result.recordCount),
    unit: t(locale, `trading.refresh.record-unit.${result.kind}`),
  }
}

function coverage(locale: Locale, result: RefreshKindResult): string {
  const succeeded = formatCount(locale, result.successfulTargetCount)

  return `${succeeded}/${formatCount(locale, result.targetCount)}`
}

function columnWidths(rows: readonly KindRow[]): ColumnWidths {
  return {
    label: widestCell(rows, 'label'),
    status: widestCell(rows, 'status'),
    coverage: widestCell(rows, 'coverage'),
    count: widestCell(rows, 'count'),
  }
}

function widestCell(rows: readonly KindRow[], column: keyof ColumnWidths): number {
  return rows.reduce((widest, row) => Math.max(widest, row[column].length), 0)
}

/** A column no row filled pads to nothing and drops out, so a run with full coverage everywhere
 *  renders without a gap where the coverage column would have been. A cell only this row left empty
 *  still pads, because the columns after it have to land where every other row put them — but a run
 *  of them at the end is trailing whitespace rather than alignment. */
function renderRow(cells: KindRow, widths: ColumnWidths): string {
  return [
    cells.label.padEnd(widths.label),
    cells.status.padEnd(widths.status),
    cells.coverage.padStart(widths.coverage),
    cells.count.padStart(widths.count),
    cells.unit,
  ]
    .filter((cell) => cell.length > 0)
    .join(COLUMN_GAP)
    .trimEnd()
}

/** The market's own deduped list, which is every kind's caveats plus the notes that belong to no
 *  kind. Read per kind instead, a code two kinds both raised printed twice. */
function noteLines(locale: Locale, result: RefreshMarketDataResult): readonly string[] {
  return renderCaveatLines(
    locale,
    result.caveats.filter((caveat) => !ROW_STATUS_CODES.has(caveat.code))
  )
}

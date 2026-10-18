import type { Locale } from '@/core/types/locale'
import type { BookDisplay } from '@/trading/features/portfolio/render/rows'
import type { SegmentValue, ValuedBook } from '@/trading/features/portfolio/types'
import type { SegmentColumn, SegmentRow } from '@/trading/render/segment-block'
import { t } from '@/i18n'
import { CASH_SEGMENT } from '@/trading/kernel/instrument'
import { disabledSegments } from '@/trading/kernel/operator/profile'
import {
  formatFixedFraction,
  formatFlow,
  renderDeclaredValue,
  renderProvidedValue,
} from '@/trading/render/format'
import { INDENT, renderOverflowLine } from '@/trading/render/layout'
import { renderSegmentBlock } from '@/trading/render/segment-block'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** The segment's weight, what it is worth, the ceiling it is held under, and how much of it is a
 *  tracker against the ceiling on those. The ETF pair is two columns rather than one: a share
 *  printed beside its own ceiling is the only form that says how much room is left. */
const PORTFOLIO_COLUMNS: readonly SegmentColumn[] = Object.freeze([
  { labelKey: 'trading.render.segment.columnCurrent', align: 'right' },
  { labelKey: 'trading.render.segment.columnValue', align: 'right' },
  { labelKey: 'trading.render.segment.columnCap', align: 'right' },
  { labelKey: 'trading.render.segment.columnEtf', align: 'right' },
  { labelKey: 'trading.render.segment.columnEtfCap', align: 'right' },
])

/** The segment table, then where the book is concentrated by sector beneath it. */
export function renderAllocationSection(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  return [
    ...renderSegmentBlock(
      locale,
      {
        columns: PORTFOLIO_COLUMNS,
        rows: book.segmentValues.map((entry) =>
          toSegmentRow(
            locale,
            {
              entry,
              weightPctNav: display.segmentWeights.get(entry.segment) ?? entry.weightPctNav,
            },
            display
          )
        ),
        disabled: namesOf(locale, disabledSegments(display.segmentCaps)),
        legend: 'trading.render.segment.legendPortfolio',
      },
      display.context
    ),
    ...renderConcentrationLines(locale, book, display),
  ]
}

/** A segment and the weight this table will print for it, which is the apportioned share rather than
 *  the fold's own — every other cell reads the fold directly. */
interface PrintedSegment {
  readonly entry: SegmentValue
  readonly weightPctNav: number
}

/** Cash is a reserve segment bounded by a floor, not a ceiling, and seeds no cap - so the lookup
 *  itself is what leaves its row without one. A segment whose market lists no ETFs, and one holding
 *  a priced position whose kind never resolved, both answer nothing rather than zero. */
function toSegmentRow(locale: Locale, segment: PrintedSegment, display: BookDisplay): SegmentRow {
  const { entry, weightPctNav } = segment
  const cap = display.segmentCaps?.[entry.segment]

  return {
    name: renderDeclaredValue(locale, `trading.segment.${entry.segment}`),
    cash: entry.segment === CASH_SEGMENT,
    cells: [
      formatFixedFraction(locale, weightPctNav),
      formatFlow(locale, entry.valueBase),
      cap === undefined ? undefined : formatFixedFraction(locale, cap.maximumSegmentPctNav),
      entry.etfPctNav === undefined ? undefined : formatFixedFraction(locale, entry.etfPctNav),
      cap?.maximumEtfPctNav === undefined
        ? undefined
        : formatFixedFraction(locale, cap.maximumEtfPctNav),
    ],
    bar: {
      now: weightPctNav,
      ...(cap === undefined ? {} : { mark: cap.maximumSegmentPctNav }),
    },
  }
}

function namesOf(locale: Locale, segments: ReadonlySet<string>): readonly string[] {
  return [...segments].map((segment) => renderDeclaredValue(locale, `trading.segment.${segment}`))
}

/** The sector fold the book already computes, capped and ranked by weight, as a sub-block of the
 *  allocation section: the question is where the operator is concentrated, not an inventory of
 *  every segment. */
function renderConcentrationLines(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  const limit = SURFACE_LIMITS.maximumConcentrationRows
  const sectors = byWeight(book.sectorValues).slice(0, limit)

  if (sectors.length === 0) {
    return []
  }

  const hidden = book.sectorValues.length - sectors.length

  return [
    `${INDENT[1]}${t(locale, 'trading.render.portfolio.concentration')}`,
    ...sectors.map(
      (entry) =>
        `${INDENT[2]}${t(locale, 'trading.render.portfolio.sectorRow', {
          sector: renderProvidedValue(locale, `trading.sector.${entry.sector}`, entry.sector),
          weight: formatFixedFraction(locale, entry.weightPctNav),
          value: formatFlow(locale, entry.valueBase),
          cap: formatFixedFraction(locale, display.sectorCapPctNav),
        })}`
    ),
    ...(hidden > 0 ? [`${INDENT[1]}${renderOverflowLine(locale, hidden)}`] : []),
  ]
}

function byWeight<T extends { readonly weightPctNav: number }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => right.weightPctNav - left.weightPctNav)
}

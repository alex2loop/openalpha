import type { Locale } from '@/core/types/locale'
import type { BookDisplay } from '@/trading/features/portfolio/render/rows'
import type { SegmentValue, ValuedBook } from '@/trading/features/portfolio/types'
import type { SleeveColumn, SleeveRow } from '@/trading/render/sleeve-block'
import { t } from '@/i18n'
import { CASH_SEGMENT } from '@/trading/kernel/instrument'
import { disabledSegments } from '@/trading/kernel/operator/profile'
import {
  formatFixedFraction,
  formatFlow,
  renderDeclaredValue,
  renderProvidedValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, renderOverflowLine, renderSectionTitle } from '@/trading/render/layout'
import { renderSleeveBlock } from '@/trading/render/sleeve-block'
import { SURFACE_LIMITS } from '@/trading/surface-limits'

/** The sleeve's weight, what it is worth, the ceiling it is held under, and how much of it is a
 *  tracker against the ceiling on those. The ETF pair is two columns rather than one: a share
 *  printed beside its own ceiling is the only form that says how much room is left. */
const PORTFOLIO_COLUMNS: readonly SleeveColumn[] = Object.freeze([
  { labelKey: 'trading.render.sleeve.columnCurrent', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnValue', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnCap', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnEtf', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnEtfCap', align: 'right' },
])

export function renderAllocationSection(
  locale: Locale,
  book: ValuedBook,
  display: BookDisplay
): readonly string[] {
  return renderSleeveBlock(
    locale,
    {
      columns: PORTFOLIO_COLUMNS,
      rows: book.segmentValues.map((entry) =>
        toSleeveRow(
          locale,
          { entry, weightPctNav: display.sleeveWeights.get(entry.segment) ?? entry.weightPctNav },
          display
        )
      ),
      disabled: namesOf(locale, disabledSegments(display.segmentCaps)),
      legend: 'trading.render.sleeve.legendPortfolio',
    },
    display.context
  )
}

/** A sleeve and the weight this table will print for it, which is the apportioned share rather than
 *  the fold's own — every other cell reads the fold directly. */
interface PrintedSleeve {
  readonly entry: SegmentValue
  readonly weightPctNav: number
}

/** Cash is a reserve sleeve bounded by a floor, not a ceiling, and seeds no cap - so the lookup
 *  itself is what leaves its row without one. A sleeve whose market lists no ETFs, and one holding
 *  a priced position whose kind never resolved, both answer nothing rather than zero. */
function toSleeveRow(locale: Locale, sleeve: PrintedSleeve, display: BookDisplay): SleeveRow {
  const { entry, weightPctNav } = sleeve
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

/** The sector fold the book already computes, capped and ranked by weight: the question is where
 *  the operator is concentrated, not an inventory of every sleeve. */
export function renderConcentrationSection(
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
    renderSectionTitle(SECTION_ICONS.sources, t(locale, 'trading.render.portfolio.concentration')),
    ...sectors.map(
      (entry) =>
        `${INDENT[1]}${t(locale, 'trading.render.portfolio.sectorRow', {
          sector: renderProvidedValue(locale, `trading.sector.${entry.sector}`, entry.sector),
          weight: formatFixedFraction(locale, entry.weightPctNav),
          value: formatFlow(locale, entry.valueBase),
          cap: formatFixedFraction(locale, display.sectorCapPctNav),
        })}`
    ),
    ...(hidden > 0 ? [renderOverflowLine(locale, hidden)] : []),
  ]
}

function byWeight<T extends { readonly weightPctNav: number }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => right.weightPctNav - left.weightPctNav)
}

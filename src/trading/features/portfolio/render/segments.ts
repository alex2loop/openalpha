import type { Locale } from '@/core/types/locale'
import type {
  CashSegmentTarget,
  PortfolioFinding,
  RebalancePlanReady,
  RebalanceSizing,
  SegmentTarget,
} from '@/trading/features/portfolio/types'
import type { RenderContext } from '@/trading/render/format'
import type { SegmentBlock, SegmentColumn, SegmentRow } from '@/trading/render/segment-block'
import { t } from '@/i18n'
import { CASH_SEGMENT } from '@/trading/kernel/instrument'
import {
  formatFixedFraction,
  formatFraction,
  fractionDirection,
  renderDeclaredValue,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'
import { apportion, FRACTION_QUANTUM } from '@/trading/render/number'
import { renderSegmentBlock } from '@/trading/render/segment-block'

const AFTER_PLAN_COLUMN: SegmentColumn = Object.freeze({
  labelKey: 'trading.render.segment.columnAfterPlan',
  align: 'right',
})

const REBALANCE_COLUMNS: readonly SegmentColumn[] = Object.freeze([
  { labelKey: 'trading.render.segment.columnCurrent', align: 'right' },
  AFTER_PLAN_COLUMN,
  { labelKey: 'trading.render.segment.columnTarget', align: 'right' },
  { labelKey: 'trading.render.segment.columnCap', align: 'right' },
  { labelKey: 'trading.render.segment.columnGap', align: 'left' },
])

/** A plan written as gaps names no landing place, so it has no after-plan column. */
const GAP_COLUMNS: readonly SegmentColumn[] = Object.freeze(
  REBALANCE_COLUMNS.filter((column) => column !== AFTER_PLAN_COLUMN)
)

/** What the share columns read of a segment row: the portfolio view builds the same three from a
 *  book with no plan, and prints through the same function. */
type SegmentShareRow = Pick<
  SegmentTarget,
  'segment' | 'currentPctNav' | 'afterPlanPctNav' | 'targetPctNav'
>

/** The three columns of one segment row that are shares of NAV, as they will be printed. */
interface SegmentShares {
  readonly currentPctNav: number
  readonly afterPlanPctNav: number
  readonly targetPctNav: number
}

interface SegmentRenderOptions {
  readonly context: RenderContext
  /** A plan written as gaps names no order, so a shortfall is never "nothing to buy yet", and no
   *  segment is measured from where orders would leave it. */
  readonly gaps: boolean
}

export function renderSegments(
  locale: Locale,
  rows: readonly SegmentTarget[],
  options: SegmentRenderOptions
): readonly string[] {
  const block: SegmentBlock = {
    columns: options.gaps ? GAP_COLUMNS : REBALANCE_COLUMNS,
    rows: printedSegmentShares(rows).map(([row, shares]) =>
      toSegmentRow(locale, row, { shares, gaps: options.gaps })
    ),
    disabled: [],
    legend: 'trading.render.segment.legendRebalance',
  }

  return renderSegmentBlock(locale, block, options.context)
}

/** Each kept segment with the share columns as this message will print them — read by the table and
 *  by the order lines above it, so a segment's weight cannot be stated two ways. A column divides
 *  NAV over exactly these rows, so it is rounded as a set rather than cell by cell, which is what
 *  printed a target column summing to 100,01% beside the same segments `/profile` had apportioned.
 *
 *  A segment at zero held and zero wanted is dropped: `SegmentTarget` carries no cap set, so it is
 *  indistinguishable here from an open segment holding nothing, and "switched off" would be false. */
export function printedSegmentShares<T extends SegmentShareRow>(
  rows: readonly T[]
): readonly (readonly [T, SegmentShares])[] {
  const held = rows.filter((row) => row.targetPctNav !== 0 || row.currentPctNav !== 0)
  const current = apportionColumn(held, (row) => row.currentPctNav)
  const afterPlan = apportionColumn(held, (row) => row.afterPlanPctNav)
  const target = apportionColumn(held, (row) => row.targetPctNav)

  return held.map((row, index) => [
    row,
    {
      currentPctNav: current[index] ?? row.currentPctNav,
      afterPlanPctNav: afterPlan[index] ?? row.afterPlanPctNav,
      targetPctNav: target[index] ?? row.targetPctNav,
    },
  ])
}

function apportionColumn(
  held: readonly SegmentShareRow[],
  read: (row: SegmentShareRow) => number
): readonly number[] {
  return apportion(held.map(read), FRACTION_QUANTUM)
}

/** Cash is a reserve segment bounded by a floor, not a cap, so its cap cell has nothing to print. */
interface SegmentRowShares {
  readonly shares: SegmentShares
  readonly gaps: boolean
}

function toSegmentRow(locale: Locale, row: SegmentTarget, printed: SegmentRowShares): SegmentRow {
  const { shares } = printed

  return {
    name: renderDeclaredValue(locale, `trading.segment.${row.segment}`),
    cash: row.segment === CASH_SEGMENT,
    cells: [
      formatFixedFraction(locale, shares.currentPctNav),
      ...(printed.gaps ? [] : [formatFixedFraction(locale, shares.afterPlanPctNav)]),
      formatFixedFraction(locale, shares.targetPctNav),
      row.capPctNav === undefined ? undefined : formatFixedFraction(locale, row.capPctNav),
      renderGap(locale, row, printed),
    ],
    bar: { now: shares.currentPctNav, mark: shares.targetPctNav },
  }
}

/** The conclusion the other numbers only imply: how far this segment sits from the policy the
 *  operator is being held to. Measured from where the plan leaves the segment, not from where it
 *  starts — the column beside this one already moved the reader past today's orders. A plan written
 *  as gaps leaves nothing anywhere, so it measures from the segment as it stands. A segment
 *  inside its band names the band and no magnitude: a figure there reads as an unfilled shortfall
 *  and sends the operator looking for a cause the planner never had.
 *
 *  The verdict reads the segment's own numbers, so no rounding unit can decide whether it is in
 *  band; the magnitude reads the apportioned ones, so subtracting the two printed columns gives
 *  the printed figure. */
function renderGap(locale: Locale, row: SegmentTarget, printed: SegmentRowShares): string {
  const { shares } = printed
  const landed = printed.gaps ? row.currentPctNav : row.afterPlanPctNav
  const landedShare = printed.gaps ? shares.currentPctNav : shares.afterPlanPctNav
  const gap = landed - row.targetPctNav
  const direction = fractionDirection(gap)

  if (direction === 'flat') {
    return t(locale, 'trading.render.rebalance.gapOnTarget')
  }

  if (Math.abs(gap) < row.driftBandPctNav) {
    return t(locale, 'trading.render.rebalance.gapInBand')
  }

  const magnitude = formatFixedFraction(locale, Math.abs(landedShare - shares.targetPctNav))

  if (direction === 'up') {
    return t(locale, 'trading.render.rebalance.gapOver', { gap: magnitude })
  }

  const placeable = printed.gaps || row.afterPlanPctNav > row.currentPctNav
  const key = placeable ? 'gapUnder' : 'gapUnreachable'

  return t(locale, `trading.render.rebalance.${key}`, { gap: magnitude })
}

/** One line per segment that bounds its ETFs, under the table rather than in it: the ceiling binds
 *  one segment of several, so a column would be empty on most rows and say less than a sentence. */
export function renderEtfCapLines(
  locale: Locale,
  rows: readonly SegmentTarget[]
): readonly string[] {
  return rows.flatMap((row) =>
    row.etfPctNav === undefined || row.etfCapPctNav === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.rebalance.etfCap', {
            segment: renderDeclaredValue(locale, `trading.segment.${row.segment}`),
            weight: formatFraction(locale, row.etfPctNav),
            cap: formatFraction(locale, row.etfCapPctNav),
          })}`,
        ]
  )
}

/** The reserve split only: where cash lands is a row of the table like every other segment, and
 *  saying it twice was the table's one ragged line. The split is measured over settled cash at book
 *  cost, so a book still waiting on sale proceeds, or holding foreign cash above cost, names that
 *  figure rather than leaving the reader to subtract it from the row above. */
export function renderCashLine(
  locale: Locale,
  advice: RebalancePlanReady,
  sizing: RebalanceSizing | null
): string {
  const { cashSegment }: { readonly cashSegment: CashSegmentTarget } = advice
  const planned =
    advice.allocation.find((row) => row.segment === CASH_SEGMENT)?.afterPlanPctNav ??
    cashSegment.cashPctNav
  // Amounts are named only where NAV is known; each gets its own key to avoid collisions.
  const money = (
    label: 'liquid' | 'term' | 'settled',
    fraction: number
  ): { readonly [name: string]: string } =>
    sizing === null
      ? {}
      : { [`${label}Amount`]: formatMoney(locale, fraction * sizing.navBase, sizing.baseCurrency) }
  const base = {
    liquid: formatFraction(locale, cashSegment.liquidReservePctNav),
    term: formatFraction(locale, cashSegment.termDepositEligiblePctNav),
  }
  const amounts = {
    ...money('liquid', cashSegment.liquidReservePctNav),
    ...money('term', cashSegment.termDepositEligiblePctNav),
  }
  const withAmounts = sizing !== null

  if (fractionDirection(planned - cashSegment.cashPctNav) === 'flat') {
    const key = withAmounts
      ? 'trading.render.rebalance.cashAmount'
      : 'trading.render.rebalance.cash'

    return `${INDENT[1]}${t(locale, key, { ...base, ...amounts })}`
  }

  const settled = formatFraction(locale, cashSegment.cashPctNav)
  const key = withAmounts
    ? 'trading.render.rebalance.cashSettledAmount'
    : 'trading.render.rebalance.cashSettled'
  const settledAmount = money('settled', cashSegment.cashPctNav)

  const line = t(locale, key, { ...base, ...amounts, ...settledAmount, settled })
  const note = cashSegment.foreignCashAtCost
    ? ` ${t(locale, 'trading.render.rebalance.cashAtCostNote')}`
    : ''

  return `${INDENT[1]}${line}${note}`
}

/** Each segment's name in the operator's language, keyed by id, for the segments listed and the
 *  ones the findings are about, so a reply names "Vietnam gold" rather than `gold-vn` while the id
 *  stays usable as tool input. */
export function segmentNames(
  locale: Locale,
  segments: readonly string[],
  findings: readonly PortfolioFinding[] = []
): Readonly<Record<string, string>> {
  const about = findings.flatMap((finding) =>
    typeof finding.subject.segment === 'string' ? [finding.subject.segment] : []
  )

  return Object.fromEntries(
    [...new Set([...segments, ...about])].map((segment) => [
      segment,
      renderDeclaredValue(locale, `trading.segment.${segment}`),
    ])
  )
}

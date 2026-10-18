import type { Locale } from '@/core/types/locale'
import type {
  CashSegmentTarget,
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

const REBALANCE_COLUMNS: readonly SegmentColumn[] = Object.freeze([
  { labelKey: 'trading.render.segment.columnCurrent', align: 'right' },
  { labelKey: 'trading.render.segment.columnAfterPlan', align: 'right' },
  { labelKey: 'trading.render.segment.columnTarget', align: 'right' },
  { labelKey: 'trading.render.segment.columnCap', align: 'right' },
  { labelKey: 'trading.render.segment.columnGap', align: 'left' },
])

/** The three columns of one segment row that are shares of NAV, as they will be printed. */
interface SegmentShares {
  readonly currentPctNav: number
  readonly afterPlanPctNav: number
  readonly targetPctNav: number
}

export function renderSegments(
  locale: Locale,
  rows: readonly SegmentTarget[],
  context: RenderContext
): readonly string[] {
  const block: SegmentBlock = {
    columns: REBALANCE_COLUMNS,
    rows: printedSegmentShares(rows).map(([row, shares]) => toSegmentRow(locale, row, shares)),
    disabled: [],
    legend: 'trading.render.segment.legendRebalance',
  }

  return renderSegmentBlock(locale, block, context)
}

/** Each kept segment with the share columns as this message will print them — read by the table and
 *  by the order lines above it, so a segment's weight cannot be stated two ways. A column divides
 *  NAV over exactly these rows, so it is rounded as a set rather than cell by cell, which is what
 *  printed a target column summing to 100,01% beside the same segments `/profile` had apportioned.
 *
 *  A segment at zero held and zero wanted is dropped: `SegmentTarget` carries no cap set, so it is
 *  indistinguishable here from an open segment holding nothing, and "switched off" would be false. */
function printedSegmentShares(
  rows: readonly SegmentTarget[]
): readonly (readonly [SegmentTarget, SegmentShares])[] {
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
  held: readonly SegmentTarget[],
  read: (row: SegmentTarget) => number
): readonly number[] {
  return apportion(held.map(read), FRACTION_QUANTUM)
}

/** Cash is a reserve segment bounded by a floor, not a cap, so its cap cell has nothing to print. */
function toSegmentRow(locale: Locale, row: SegmentTarget, shares: SegmentShares): SegmentRow {
  return {
    name: renderDeclaredValue(locale, `trading.segment.${row.segment}`),
    cash: row.segment === CASH_SEGMENT,
    cells: [
      formatFixedFraction(locale, shares.currentPctNav),
      formatFixedFraction(locale, shares.afterPlanPctNav),
      formatFixedFraction(locale, shares.targetPctNav),
      row.capPctNav === undefined ? undefined : formatFixedFraction(locale, row.capPctNav),
      renderGap(locale, row, shares),
    ],
    bar: { now: shares.currentPctNav, mark: shares.targetPctNav },
  }
}

/** The conclusion the other three numbers only imply: how far this segment sits from the policy the
 *  operator is being held to. Measured from where the plan leaves the segment, not from where it
 *  starts — the column beside this one already moved the reader past today's orders. A segment
 *  inside its band names the band and no magnitude: a figure there reads as an unfilled shortfall
 *  and sends the operator looking for a cause the planner never had.
 *
 *  The verdict reads the segment's own numbers, so no rounding unit can decide whether it is in
 *  band; the magnitude reads the apportioned ones, so subtracting the two printed columns gives
 *  the printed figure. */
function renderGap(locale: Locale, row: SegmentTarget, shares: SegmentShares): string {
  const gap = row.afterPlanPctNav - row.targetPctNav
  const direction = fractionDirection(gap)

  if (direction === 'flat') {
    return t(locale, 'trading.render.rebalance.gapOnTarget')
  }

  if (Math.abs(gap) < row.driftBandPctNav) {
    return t(locale, 'trading.render.rebalance.gapInBand')
  }

  const printed = formatFixedFraction(
    locale,
    Math.abs(shares.afterPlanPctNav - shares.targetPctNav)
  )

  if (direction === 'up') {
    return t(locale, 'trading.render.rebalance.gapOver', { gap: printed })
  }

  const key = row.afterPlanPctNav > row.currentPctNav ? 'gapUnder' : 'gapUnreachable'

  return t(locale, `trading.render.rebalance.${key}`, { gap: printed })
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
 *  saying it twice was the table's one ragged line. The split is measured over settled cash, so a
 *  book still waiting on sale proceeds names that figure rather than leaving the reader to subtract
 *  it from the row above. */
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

  return `${INDENT[1]}${t(locale, key, {
    ...base,
    ...amounts,
    ...settledAmount,
    settled,
  })}`
}

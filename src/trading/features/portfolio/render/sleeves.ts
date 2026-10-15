import type { Locale } from '@/core/types/locale'
import type {
  CashSleeveTarget,
  RebalancePlanReady,
  RebalanceSizing,
  SegmentTarget,
} from '@/trading/features/portfolio/types'
import type { PortfolioSegment } from '@/trading/kernel/instrument'
import type { RenderContext } from '@/trading/render/format'
import type { SleeveBlock, SleeveColumn, SleeveRow } from '@/trading/render/sleeve-block'
import { t } from '@/i18n'
import { buildInstrumentKey, CASH_SEGMENT } from '@/trading/kernel/instrument'
import {
  formatFixedFraction,
  formatFraction,
  fractionDirection,
  renderDeclaredValue,
} from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'
import { apportion, FRACTION_QUANTUM } from '@/trading/render/number'
import { renderSleeveBlock } from '@/trading/render/sleeve-block'

const REBALANCE_COLUMNS: readonly SleeveColumn[] = Object.freeze([
  { labelKey: 'trading.render.sleeve.columnCurrent', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnAfterPlan', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnTarget', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnCap', align: 'right' },
  { labelKey: 'trading.render.sleeve.columnGap', align: 'left' },
])

/** The three columns of one sleeve row that are shares of NAV, as they will be printed. */
interface SleeveShares {
  readonly currentPctNav: number
  readonly afterPlanPctNav: number
  readonly targetPctNav: number
}

/** Where one order leaves its sleeve, twice over: the two figures printed from it tie to different
 *  things. */
export interface SegmentProgress {
  /** The weights the table below prints, so no line states one sleeve's weight two ways. */
  readonly from: number
  readonly to: number
  /** The same points unrounded, which the money reads: an opening amount plus the order on that
   *  line has to reach its closing amount. */
  readonly fromExact: number
  readonly toExact: number
}

/** Each order's `from`/`to` as its segment's running weight, walked in plan order, so several buys in
 *  one sleeve read as a climb rather than each restating its own instrument from the start. The
 *  printed ends are the table's own: rounded off this walk instead, the first `from` sat a rounding
 *  unit from the row stating the same weight, and one message called the crypto sleeve 3,12% and
 *  3,11%. */
export function cumulativeSegmentWeights(
  advice: RebalancePlanReady
): ReadonlyMap<string, SegmentProgress> {
  const sleeves = new Map(
    printedSleeveShares(advice.allocation).map(([row, shares]) => [row.segment, { row, shares }])
  )
  const closing = new Map<PortfolioSegment, string>()

  for (const row of advice.rebalance) {
    closing.set(row.segment, buildInstrumentKey(row.instrument))
  }

  const running = new Map<PortfolioSegment, number>()
  const result = new Map<string, SegmentProgress>()

  for (const change of advice.rebalance) {
    const sleeve = sleeves.get(change.segment)

    if (sleeve === undefined) {
      continue
    }

    const key = buildInstrumentKey(change.instrument)
    const opening = running.get(change.segment)
    const fromExact = opening ?? sleeve.row.currentPctNav
    const toExact = fromExact + change.changePctNav

    running.set(change.segment, toExact)
    result.set(key, {
      from: opening ?? sleeve.shares.currentPctNav,
      to: closing.get(change.segment) === key ? sleeve.shares.afterPlanPctNav : toExact,
      fromExact,
      toExact,
    })
  }

  return result
}

export function renderSleeves(
  locale: Locale,
  rows: readonly SegmentTarget[],
  context: RenderContext
): readonly string[] {
  const block: SleeveBlock = {
    columns: REBALANCE_COLUMNS,
    rows: printedSleeveShares(rows).map(([row, shares]) => toSleeveRow(locale, row, shares)),
    disabled: [],
    legend: 'trading.render.sleeve.legendRebalance',
  }

  return renderSleeveBlock(locale, block, context)
}

/** Each kept sleeve with the share columns as this message will print them — read by the table and
 *  by the order lines above it, so a sleeve's weight cannot be stated two ways. A column divides
 *  NAV over exactly these rows, so it is rounded as a set rather than cell by cell, which is what
 *  printed a target column summing to 100,01% beside the same sleeves `/profile` had apportioned.
 *
 *  A sleeve at zero held and zero wanted is dropped: `SegmentTarget` carries no cap set, so it is
 *  indistinguishable here from an open sleeve holding nothing, and "switched off" would be false. */
function printedSleeveShares(
  rows: readonly SegmentTarget[]
): readonly (readonly [SegmentTarget, SleeveShares])[] {
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

/** Cash is a reserve sleeve bounded by a floor, not a cap, so its cap cell has nothing to print. */
function toSleeveRow(locale: Locale, row: SegmentTarget, shares: SleeveShares): SleeveRow {
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

/** The conclusion the other three numbers only imply: how far this sleeve sits from the policy the
 *  operator is being held to. Measured from where the plan leaves the sleeve, not from where it
 *  starts — the column beside this one already moved the reader past today's orders. A sleeve
 *  inside its band names the band and no magnitude: a figure there reads as an unfilled shortfall
 *  and sends the operator looking for a cause the planner never had.
 *
 *  The verdict reads the sleeve's own numbers, so no rounding unit can decide whether it is in
 *  band; the magnitude reads the apportioned ones, so subtracting the two printed columns gives
 *  the printed figure. */
function renderGap(locale: Locale, row: SegmentTarget, shares: SleeveShares): string {
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

/** One line per sleeve that bounds its ETFs, under the table rather than in it: the ceiling binds
 *  one sleeve of several, so a column would be empty on most rows and say less than a sentence. */
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

/** The reserve split only: where cash lands is a row of the table like every other sleeve, and
 *  saying it twice was the table's one ragged line. The split is measured over settled cash, so a
 *  book still waiting on sale proceeds names that figure rather than leaving the reader to subtract
 *  it from the row above. */
export function renderCashLine(
  locale: Locale,
  advice: RebalancePlanReady,
  sizing: RebalanceSizing | null
): string {
  const { cashSleeve }: { readonly cashSleeve: CashSleeveTarget } = advice
  const planned =
    advice.allocation.find((row) => row.segment === CASH_SEGMENT)?.afterPlanPctNav ??
    cashSleeve.cashPctNav
  // Amounts are named only where NAV is known; each gets its own key to avoid collisions.
  const money = (
    label: 'liquid' | 'term' | 'settled',
    fraction: number
  ): { readonly [name: string]: string } =>
    sizing === null
      ? {}
      : { [`${label}Amount`]: formatMoney(locale, fraction * sizing.navBase, sizing.baseCurrency) }
  const base = {
    liquid: formatFraction(locale, cashSleeve.liquidReservePctNav),
    term: formatFraction(locale, cashSleeve.termDepositEligiblePctNav),
  }
  const amounts = {
    ...money('liquid', cashSleeve.liquidReservePctNav),
    ...money('term', cashSleeve.termDepositEligiblePctNav),
  }
  const withAmounts = sizing !== null

  if (fractionDirection(planned - cashSleeve.cashPctNav) === 'flat') {
    const key = withAmounts
      ? 'trading.render.rebalance.cashAmount'
      : 'trading.render.rebalance.cash'

    return `${INDENT[1]}${t(locale, key, { ...base, ...amounts })}`
  }

  const settled = formatFraction(locale, cashSleeve.cashPctNav)
  const key = withAmounts
    ? 'trading.render.rebalance.cashSettledAmount'
    : 'trading.render.rebalance.cashSettled'
  const settledAmount = money('settled', cashSleeve.cashPctNav)

  return `${INDENT[1]}${t(locale, key, {
    ...base,
    ...amounts,
    ...settledAmount,
    settled,
  })}`
}

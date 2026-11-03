import type { Locale } from '@/core/types/locale'
import type {
  PositionChange,
  RebalancePlanReady,
  RebalanceSizing,
} from '@/trading/features/portfolio/types'
import { t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { formatFixedFraction, fractionDirection } from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'

interface RenderedGap {
  readonly row: PositionChange
  /** The row's text without the surface's indent; a later line of one gap is separated by \n. */
  readonly text: string
}

/** Where each name stands against the weight the plan gives it, and what that gap is worth in
 *  money. Names a side of the gap and nothing to do about it: no order verb, no quantity. */
export function renderGapEntries(
  locale: Locale,
  advice: RebalancePlanReady,
  sizing: RebalanceSizing | null
): readonly RenderedGap[] {
  return advice.rebalance.map((row) => ({
    row,
    text: [renderGap(locale, row), ...renderGapValue(locale, row, sizing)].join('\n'),
  }))
}

export function renderGapRows(
  locale: Locale,
  advice: RebalancePlanReady,
  sizing: RebalanceSizing | null
): readonly string[] {
  return renderGapEntries(locale, advice, sizing).map((entry) => `${INDENT[1]}${entry.text}`)
}

function renderGap(locale: Locale, row: PositionChange): string {
  const side = fractionDirection(row.changePctNav) === 'down' ? 'Over' : 'Under'
  const gap = t(locale, `trading.render.rebalance.gap${side}`, {
    gap: formatFixedFraction(locale, Math.abs(row.changePctNav)),
  })

  return t(locale, 'trading.render.rebalance.gapRow', {
    ticker: `${row.instrument.ticker}${renderKindBadge(locale, row.instrumentKind)}`,
    current: formatFixedFraction(locale, row.currentPctNav),
    target: formatFixedFraction(locale, row.targetPctNav),
    gap,
  })
}

function renderGapValue(
  locale: Locale,
  row: PositionChange,
  sizing: RebalanceSizing | null
): readonly string[] {
  const size = sizing?.byInstrument.get(buildInstrumentKey(row.instrument))

  if (sizing === null || size === undefined) {
    return []
  }

  return [
    `${INDENT[2]}${t(locale, 'trading.render.rebalance.gapValue', {
      amount: formatMoney(locale, size.valueBase, sizing.baseCurrency),
    })}`,
  ]
}

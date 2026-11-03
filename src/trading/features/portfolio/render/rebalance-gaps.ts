import type { Locale } from '@/core/types/locale'
import type {
  PositionChange,
  RebalancePlanReady,
  RebalanceSizing,
} from '@/trading/features/portfolio/types'
import type { Caveat } from '@/trading/kernel/caveat'
import { t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { formatFixedFraction, fractionDirection } from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'

export const REGIME_CAVEAT = 'portfolio.regime-risk'

/** The plan caveats a gaps plan leaves out: each says what to buy or sell, or names a candidate
 *  to look at, and a gaps plan states neither. The regime caveat says how much of a buy today
 *  allows. */
const GAPS_DROPPED_CAVEATS: ReadonlySet<string> = new Set([
  REGIME_CAVEAT,
  'portfolio.candidates-available',
  'portfolio.candidates-by-name',
  'portfolio.candidates-outside-cap',
  'portfolio.increase-below-minimum',
  'portfolio.increases-underfunded',
  'portfolio.reduce-standing',
  'portfolio.reduction-below-minimum',
  'portfolio.reduction-illiquid',
  'portfolio.reduction-unsettled',
  'portfolio.segment-no-candidates',
])

/** True for a caveat a gaps plan keeps: its text, surface notes and wire all ask this one. */
export function isGapsCaveat(caveat: Caveat): boolean {
  return !GAPS_DROPPED_CAVEATS.has(caveat.code)
}

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

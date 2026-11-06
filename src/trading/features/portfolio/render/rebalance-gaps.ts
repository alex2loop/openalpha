import type { Locale } from '@/core/types/locale'
import type {
  PositionChange,
  RebalanceForm,
  RebalancePlanReady,
  RebalanceSizing,
} from '@/trading/features/portfolio/types'
import type { Caveat, CaveatCode } from '@/trading/kernel/caveat'
import { t } from '@/i18n'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { formatFixedFraction, fractionDirection } from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT } from '@/trading/render/layout'
import { formatMoney } from '@/trading/render/money'

export const REGIME_CAVEAT = 'portfolio.regime-risk'

type PortfolioCaveatCode = Extract<CaveatCode, `portfolio.${string}`>

/** Every portfolio caveat and whether a gaps plan states it. A drop names a buy, a size, a
 *  candidate or a score, which a gaps plan states none of; the keys are exhaustive, so a new
 *  portfolio caveat cannot ship without this decision. */
const GAPS_CAVEATS = {
  'portfolio.valuation-partial': 'keep',
  'portfolio.concentration-unchecked': 'keep',
  'portfolio.targets-renormalized': 'drop',
  'portfolio.targets-unfilled': 'drop',
  'portfolio.too-few-candidates': 'drop',
  'portfolio.shared-cap-full': 'drop',
  'portfolio.core-unfilled': 'drop',
  'portfolio.segment-no-candidates': 'drop',
  'portfolio.candidates-available': 'drop',
  'portfolio.candidates-outside-cap': 'drop',
  'portfolio.candidates-by-name': 'drop',
  'portfolio.holding-signal-missing': 'drop',
  'portfolio.increases-underfunded': 'drop',
  'portfolio.increase-below-minimum': 'drop',
  'portfolio.reduce-standing': 'drop',
  'portfolio.reduction-below-minimum': 'drop',
  'portfolio.reduction-unsettled': 'drop',
  'portfolio.reduction-illiquid': 'drop',
  'portfolio.candidate-illiquid': 'drop',
  'portfolio.unmeasured-volatility': 'drop',
  [REGIME_CAVEAT]: 'drop',
} as const satisfies Record<PortfolioCaveatCode, 'keep' | 'drop'>

const GAPS_DECISIONS: Readonly<Partial<Record<CaveatCode, 'keep' | 'drop'>>> = GAPS_CAVEATS

/** The caveats a plan of `form` states; a gaps plan's text, surface notes and wire all read this. */
export function keptCaveats(
  caveats: readonly Caveat[],
  form: RebalanceForm | undefined
): readonly Caveat[] {
  if (form !== 'gaps') {
    return caveats
  }

  return caveats.filter((caveat) => GAPS_DECISIONS[caveat.code] !== 'drop')
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

import type { Locale } from '@/core/types/locale'
import type {
  PortfolioFinding,
  RebalancePlanReady,
  RebalancePlanResult,
  RebalancePolicyView,
  RebalanceSizing,
  ValuedBook,
} from '@/trading/features/portfolio/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { PriceFreshness } from '@/trading/kernel/operator/book'
import type { RenderContext } from '@/trading/render/format'
import type { QuoteConvention } from '@/trading/render/money'
import { pluralKey, t } from '@/i18n'
import { WEAK_HOLDING_SIGNAL_THRESHOLD } from '@/trading/features/portfolio/folds/policy'
import { renderProfileStamp } from '@/trading/features/profile/render'
import { buildInstrumentKey, CASH_SEGMENT } from '@/trading/kernel/instrument'
import { renderCaveatLines } from '@/trading/render/caveat'
import {
  formatCount,
  formatFlow,
  formatFraction,
  formatScoreValue,
  fractionDirection,
  renderDeclaredValue,
  SECTION_ICONS,
} from '@/trading/render/format'
import { renderFreshness } from '@/trading/render/freshness'
import { INDENT, joinSections, renderSectionTitle } from '@/trading/render/layout'
import { formatMoney, formatSignedMoney } from '@/trading/render/money'
import { renderSubject } from '@/trading/render/subject'

import { renderOrders, sizedAction, splitBreaches } from './rebalance-orders'
import { renderCashLine, renderEtfCapLines, renderSleeves } from './sleeves'

const DRIFT_FINDING = 'segment-drift'

export interface RebalanceRenderOptions {
  readonly context: RenderContext
  readonly listedOnly: boolean
  /** Present on an operator surface only. Without it the orders print weights alone. */
  readonly sizing?: RebalanceSizing | null
  /** How the marks behind this advice were taken, stated beside the NAV. */
  readonly freshness?: PriceFreshness
  /** Share of a sized buy entered on the first order. A renderer cannot reach the profile. */
  readonly entryTranchePct?: number
  /** How each row's market quotes a price. A renderer cannot reach the registry. */
  readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  /** The valued book the plan was measured against, for the post-plan sector read. */
  readonly book?: ValuedBook
  /** The cap the post-plan sector is read against. */
  readonly maximumSectorPctNav?: number
}

/** Four blocks, blank-line separated: what to do, where the book stands, what to know, and the
 *  policy it was all measured against. The order is urgency, and the blanks are what let a reader
 *  stop at the first block. */
export function renderRebalanceText(
  locale: Locale,
  advice: RebalancePlanResult,
  options: RebalanceRenderOptions
): string {
  if (advice.kind === 'unavailable') {
    return joinSections([
      [renderDeclaredValue(locale, `trading.advice.unavailable.${advice.reason}`)],
      renderNotes(locale, advice.findings, advice.caveats),
    ])
  }

  const sizing = options.sizing ?? null

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.advice, t(locale, 'trading.render.rebalance.title')),
      ...renderNavLine(locale, sizing, options),
      `${INDENT[1]}${renderProfileStamp(locale, advice.policy.profile)}`,
      ...renderOrders(locale, advice, options),
      ...renderPlanTotals(locale, advice, options),
      ...renderAfterPlan(locale, advice, options),
    ],
    [
      ...renderSleeves(locale, advice.allocation, options.context),
      ...renderEtfCapLines(locale, advice.allocation),
      renderCashLine(locale, advice, sizing),
    ],
    [...renderDeploymentLines(locale, advice.policy), ...renderWeakHoldingLines(locale, advice)],
    renderNotes(locale, advice.findings, [...advice.cashSleeve.caveats, ...advice.caveats]),
    ...(options.listedOnly ? [[t(locale, 'trading.render.rebalance.listedOnly')]] : []),
  ])
}

/** The number every percentage on the page is a share of. Operator surfaces only: relative advice
 *  carries no NAV to name. */
export function renderNavLine(
  locale: Locale,
  sizing: RebalanceSizing | null,
  options: RebalanceRenderOptions
): readonly string[] {
  if (sizing === null) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.rebalance.nav', {
      amount: formatMoney(locale, sizing.navBase, sizing.baseCurrency),
      compact: formatFlow(locale, sizing.navBase),
    })}${renderFreshness(locale, options.freshness, options.context.timezone)}`,
  ]
}

// A book whose every segment sits inside its drift band has nothing to trade, which is an answer
// rather than a gap.
/** What the plan does to cash, so the reader is not adding rows by hand. Summed from the sizing map
 *  that already keys them, never from the rows a second time. */
export function renderPlanTotals(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  const sizing = options.sizing ?? null

  if (sizing === null || advice.rebalance.length === 0) {
    return []
  }

  let bought = 0
  let sold = 0

  for (const row of advice.rebalance) {
    const size = sizing.byInstrument.get(buildInstrumentKey(row.instrument))

    if (size === undefined) {
      continue
    }

    if (fractionDirection(row.changePctNav) === 'down') {
      sold += size.valueBase
    } else {
      bought += size.valueBase
    }
  }

  return [
    ...renderSingleAndNull(locale, advice, options),
    `${INDENT[1]}${t(locale, 'trading.render.rebalance.planTotals', {
      sold: formatMoney(locale, sold, sizing.baseCurrency),
      bought: formatMoney(locale, bought, sizing.baseCurrency),
      net: formatSignedMoney(locale, sold - bought, sizing.baseCurrency),
    })}`,
  ]
}

/** The one thing to do and what happens if nothing is done. Absent when the plan has no rows at
 *  all, since `noChanges` already answers that. */
function renderSingleAndNull(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  const sizing = options.sizing ?? null
  const { breaches } = splitBreaches(advice.rebalance)
  const first = breaches[0] ?? advice.rebalance[0]
  const action =
    first === undefined || sizing === null
      ? undefined
      : sizedAction(locale, first, {
          sizing,
          ...(options.quoteConventions === undefined
            ? {}
            : { quoteConventions: options.quoteConventions }),
        })

  return [
    ...(action === undefined
      ? []
      : [`${INDENT[1]}${t(locale, 'trading.render.rebalance.onlyOne', { action })}`]),
    `${INDENT[1]}${doNothingLine(locale, advice, breaches.length)}`,
  ]
}

/** Three states, because "no cap is breached" is a claim about the book and a plan row is not the
 *  only thing that can breach one: a breach smaller than a board lot leaves a finding and no order,
 *  and a clean line printed above that finding contradicts it. */
function doNothingLine(locale: Locale, advice: RebalancePlanReady, breachCount: number): string {
  if (breachCount > 0) {
    const key = pluralKey(
      breachCount,
      'trading.render.rebalance.doNothingBreachOne',
      'trading.render.rebalance.doNothingBreach'
    )

    return t(locale, key, { count: formatCount(locale, breachCount) })
  }

  return advice.findings.length > 0
    ? t(locale, 'trading.render.rebalance.doNothingUnchanged')
    : t(locale, 'trading.render.rebalance.doNothingClean')
}

/** What the book looks like once the plan's orders are placed: cash lands where the sleeve says,
 *  and the largest industry reads against the cap that binds it. Absent when any of the three is
 *  unknown — a consequence stated from a partial read would disagree with the rows above it. */
export function renderAfterPlan(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  const cash = advice.allocation.find((row) => row.segment === CASH_SEGMENT)?.afterPlanPctNav
  const largest = largestSectorAfter(advice, options.book)

  if (cash === undefined || largest === undefined || options.maximumSectorPctNav === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.rebalance.afterPlan', {
      cash: formatFraction(locale, cash),
      sector: formatFraction(locale, largest),
      cap: formatFraction(locale, options.maximumSectorPctNav),
    })}`,
  ]
}

/** Current industry weights moved by the plan's own deltas. A row the market names no industry for
 *  moves nothing: a sectorless market stays outside the check the way the valuation leaves it. */
function largestSectorAfter(
  advice: RebalancePlanReady,
  book: ValuedBook | undefined
): number | undefined {
  if (book === undefined || book.sectorValues.length === 0) {
    return undefined
  }

  const weights = new Map(book.sectorValues.map((entry) => [entry.sector, entry.weightPctNav]))

  for (const row of advice.rebalance) {
    if (row.sector === undefined) {
      continue
    }

    weights.set(row.sector, (weights.get(row.sector) ?? 0) + row.changePctNav)
  }

  let largest: number | undefined

  for (const weight of weights.values()) {
    if (largest === undefined || weight > largest) {
      largest = weight
    }
  }

  return largest
}

export function renderDeploymentLines(
  locale: Locale,
  policy: RebalancePolicyView
): readonly string[] {
  return policy.deploymentScale >= 1
    ? []
    : [
        `${INDENT[1]}${t(locale, 'trading.render.rebalance.deployment', {
          deployment: formatFraction(locale, policy.deploymentScale),
        })}`,
      ]
}

export function renderNotes(
  locale: Locale,
  findings: readonly PortfolioFinding[],
  caveats: Parameters<typeof renderCaveatLines>[1]
): readonly string[] {
  return [
    ...renderFindingLines(locale, findings),
    ...renderCaveatLines(locale, caveats, { collapseInfo: true }),
  ]
}

/** A name the plan already sells carries the score that condemned it on its own row, so the note
 *  would be the same fact with less of it. */
export function renderWeakHoldingLines(
  locale: Locale,
  advice: RebalancePlanReady
): readonly string[] {
  const sold = new Set(
    advice.rebalance
      .filter((row) => row.reason.kind === 'weak-signal')
      .map((row) => buildInstrumentKey(row.instrument))
  )

  return advice.weakHoldings
    .filter((holding) => !sold.has(buildInstrumentKey(holding.instrument)))
    .map(
      (holding) =>
        `${INDENT[1]}${t(locale, 'trading.advice.weak-holding', {
          ticker: holding.instrument.ticker,
          signal: formatScoreValue(locale, holding.signal),
          threshold: formatScoreValue(locale, WEAK_HOLDING_SIGNAL_THRESHOLD),
        })}`
    )
}

/** The sleeve table states drift in numbers, so the finding that says the same in words would be
 *  the fact twice. */
function renderFindingLines(
  locale: Locale,
  findings: readonly PortfolioFinding[]
): readonly string[] {
  return findings
    .filter((finding) => finding.kind !== DRIFT_FINDING)
    .map(
      (finding) =>
        `${INDENT[1]}${renderDeclaredValue(locale, `trading.finding.${finding.kind}`, renderSubject(locale, finding.subject))}`
    )
}

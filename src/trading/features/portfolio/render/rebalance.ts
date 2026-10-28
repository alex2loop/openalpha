import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type {
  PortfolioFinding,
  RebalancePlanReady,
  RebalancePlanResult,
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
import { formatMoney } from '@/trading/render/money'
import { renderSubject } from '@/trading/render/subject'

import { renderOrders, splitBreaches } from './rebalance-orders'
import { printedSegmentShares, renderCashLine, renderEtfCapLines, renderSegments } from './segments'

const DRIFT_FINDING = 'segment-drift'
const REGIME_CAVEAT = 'portfolio.regime-risk'

interface PlanSums {
  readonly sold: number
  readonly bought: number
  readonly sells: number
  readonly buys: number
}

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

/** The plan and its orders first; the book, the notes, then the NAV and profile it was measured
 *  against follow, blank-line separated so a reader can stop after the first block. */
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
      renderSectionTitle(SECTION_ICONS.advice, renderRebalanceTitle(locale, advice, options)),
      ...renderOrders(locale, advice, options),
      ...renderBreachLine(locale, advice),
      ...renderAfterPlan(locale, advice, options),
    ],
    [
      ...renderSegments(locale, advice.allocation, options.context),
      ...renderEtfCapLines(locale, advice.allocation),
      renderCashLine(locale, advice, sizing),
    ],
    renderStanceLines(locale, advice),
    renderNotes(locale, advice.findings, [...advice.cashSegment.caveats, ...advice.caveats]),
    [
      ...renderNavLine(locale, sizing, options),
      `${INDENT[1]}${renderProfileStamp(locale, advice.policy.profile)}`,
    ].map((line) => line.trimStart()),
    ...(options.listedOnly ? [[t(locale, 'trading.render.rebalance.listedOnly')]] : []),
  ])
}

/** The plan in one line, as the page's own title: how many orders on each side and what they move
 *  in money. A plan with nothing sized keeps the generic title and its rows say why. */
export function renderRebalanceTitle(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): string {
  const sizing = options.sizing ?? null
  const sums = sizing === null ? undefined : planSums(advice, sizing)

  if (sizing === null || sums === undefined || sums.buys + sums.sells === 0) {
    return t(locale, 'trading.render.rebalance.title')
  }

  return t(locale, titleKey(sums), {
    buys: formatCount(locale, sums.buys),
    sells: formatCount(locale, sums.sells),
    bought: formatMoney(locale, sums.bought, sizing.baseCurrency),
    sold: formatMoney(locale, sums.sold, sizing.baseCurrency),
  })
}

/** A plan that only buys or only sells names the one side: "sells 0 VND" is a figure with nothing
 *  behind it. */
function titleKey(sums: PlanSums): MessageKey {
  if (sums.sells === 0) {
    return pluralKey(
      sums.buys,
      'trading.render.rebalance.titleBuyOne',
      'trading.render.rebalance.titleBuy'
    )
  }

  if (sums.buys === 0) {
    return pluralKey(
      sums.sells,
      'trading.render.rebalance.titleSellOne',
      'trading.render.rebalance.titleSell'
    )
  }

  return 'trading.render.rebalance.titleBoth'
}

/** Each order's money read from the sizing map, the one place it was computed. */
function planSums(advice: RebalancePlanReady, sizing: RebalanceSizing): PlanSums {
  let sold = 0
  let bought = 0
  let sells = 0
  let buys = 0

  for (const row of advice.rebalance) {
    const size = sizing.byInstrument.get(buildInstrumentKey(row.instrument))

    if (size === undefined) {
      continue
    }

    if (fractionDirection(row.changePctNav) === 'down') {
      sold += size.valueBase
      sells += 1
    } else {
      bought += size.valueBase
      buys += 1
    }
  }

  return { sold, bought, sells, buys }
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

/** What leaving the plan undone costs, stated only where it costs something: positions still
 *  outside the operator's policy. A breach smaller than a board lot leaves a finding and no order,
 *  and the notes below carry it. */
export function renderBreachLine(locale: Locale, advice: RebalancePlanReady): readonly string[] {
  const count = splitBreaches(advice.rebalance).breaches.length

  if (count === 0) {
    return []
  }

  const key = pluralKey(
    count,
    'trading.render.rebalance.doNothingBreachOne',
    'trading.render.rebalance.doNothingBreach'
  )

  return [`${INDENT[1]}${t(locale, key, { count: formatCount(locale, count) })}`]
}

/** What the book looks like once the plan's orders are placed: cash lands where the segment says,
 *  and the largest industry reads against the cap that binds it. Absent when any of the three is
 *  unknown — a consequence stated from a partial read would disagree with the rows above it. */
export function renderAfterPlan(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  // The table's own rounding, so the two lines state one figure.
  const cash = printedSegmentShares(advice.allocation).find(
    ([row]) => row.segment === CASH_SEGMENT
  )?.[1].afterPlanPctNav
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

/** How hard today's plan leans: what share of the planned buying it may spend, and which held
 *  names read weak without being sold. */
export function renderStanceLines(locale: Locale, advice: RebalancePlanReady): readonly string[] {
  return [...renderDeploymentLines(locale, advice), ...renderWeakHoldingLines(locale, advice)]
}

/** The share of the planned buying today's scale allows. A segment whose regime set it already says
 *  so in its own warning, so the line speaks only where nothing else does: the profile's own
 *  ceiling binding on a calm day. */
function renderDeploymentLines(locale: Locale, advice: RebalancePlanReady): readonly string[] {
  const statedByRegime = advice.caveats.some((caveat) => caveat.code === REGIME_CAVEAT)

  if (advice.policy.deploymentScale >= 1 || statedByRegime) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.rebalance.deployment', {
      deployment: formatFraction(locale, advice.policy.deploymentScale),
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

/** A name the plan sells whole or for its weak score has its row, and a note saying no sale is
 *  needed yet would contradict it; an odd lot left after a weak exit is the same sale. A name only
 *  trimmed to a cap keeps the note: the rest of it still stands. */
function renderWeakHoldingLines(locale: Locale, advice: RebalancePlanReady): readonly string[] {
  const sold = new Set(
    advice.rebalance
      .filter((row) => row.targetPctNav <= 0 || row.reason.kind === 'weak-signal')
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

/** The segment table states drift in numbers, so the finding that says the same in words would be
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

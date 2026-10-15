import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { SegmentProgress } from '@/trading/features/portfolio/render/sleeves'
import type {
  ChangeReason,
  PositionChange,
  RebalancePlanReady,
  RebalanceSizing,
  SegmentTarget,
} from '@/trading/features/portfolio/types'
import type { MarketRef } from '@/trading/kernel/instrument'
import type { RenderContext } from '@/trading/render/format'
import type { QuoteConvention } from '@/trading/render/money'
import { t } from '@/i18n'
import { WEAK_HOLDING_SIGNAL_THRESHOLD } from '@/trading/features/portfolio/folds/policy'
import { buildInstrumentKey, floorToLot } from '@/trading/kernel/instrument'
import {
  formatFixedFraction,
  formatQuantity,
  formatScoreValue,
  fractionDirection,
  renderDeclaredValue,
  SIDE_MARKS,
} from '@/trading/render/format'
import { renderKindBadge } from '@/trading/render/kind-badge'
import { INDENT, toFactLines } from '@/trading/render/layout'
import { formatMoney, formatQuotedPrice, quotedInOf } from '@/trading/render/money'

import { cumulativeSegmentWeights } from './sleeves'

/** A row the policy no longer permits, as against one that merely drifted. Only these two arms name
 *  a position the plan is correcting rather than tuning. */
function isBreach(reason: ChangeReason): boolean {
  return reason.kind === 'weak-signal' || reason.kind === 'off-policy'
}

interface BreachSplit {
  readonly breaches: readonly PositionChange[]
  readonly drifts: readonly PositionChange[]
}

/** Breaches first: a position the policy no longer permits outranks one that merely drifted. */
export function splitBreaches(rows: readonly PositionChange[]): BreachSplit {
  return {
    breaches: rows.filter((row) => isBreach(row.reason)),
    drifts: rows.filter((row) => !isBreach(row.reason)),
  }
}

/** What each helper below needs to price a row, narrowed from the command's own option bag so no
 *  order renderer reaches for a field it does not read. */
interface OrderPricing {
  readonly context: RenderContext
  readonly sizing?: RebalanceSizing | null
  readonly entryTranchePct?: number
  readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
}

/** A plan with no orders is two different messages, and the sleeve table below decides which: every
 *  sleeve inside its band is nothing to do, while a sleeve outside one that still placed nothing is
 *  blocked, not balanced. Saying the first over the second told an operator holding three quarters
 *  of NAV in cash that everything was close enough to target. */
function emptyPlanKey(allocation: readonly SegmentTarget[]): MessageKey {
  const drifted = allocation.some(
    (segment) => Math.abs(segment.currentPctNav - segment.targetPctNav) > segment.driftBandPctNav
  )

  return drifted ? 'trading.render.rebalance.noOrders' : 'trading.render.rebalance.noChanges'
}

/** Which group a row prints under: a breach is a position the policy no longer permits. */
type OrderGroup = 'breach' | 'drift'

interface RenderedOrder {
  readonly row: PositionChange
  readonly group: OrderGroup
  /** The row's text without the surface's indent; later lines of one order are separated by \n. */
  readonly text: string
}

/** Every order of a plan, breaches first, written once for the CLI and for an app surface. */
export function renderOrderRows(
  locale: Locale,
  advice: RebalancePlanReady,
  options: OrderPricing
): readonly RenderedOrder[] {
  const sizing = options.sizing ?? null
  const progress = cumulativeSegmentWeights(advice)
  const { breaches, drifts } = splitBreaches(advice.rebalance)
  const render = (row: PositionChange, group: OrderGroup): RenderedOrder => ({
    row,
    group,
    text: renderOrder(locale, row, {
      context: options.context,
      sizing,
      progress: progress.get(buildInstrumentKey(row.instrument)),
      ...(options.entryTranchePct === undefined
        ? {}
        : { entryTranchePct: options.entryTranchePct }),
      ...(options.quoteConventions === undefined
        ? {}
        : { quoteConventions: options.quoteConventions }),
    }),
  })

  return [
    ...breaches.map((row) => render(row, 'breach')),
    ...drifts.map((row) => render(row, 'drift')),
  ]
}

/** The sentence an empty plan prints, exported so an app surface says it the same way. */
export function emptyPlanLine(locale: Locale, advice: RebalancePlanReady): string {
  return t(locale, emptyPlanKey(advice.allocation))
}

/** The drift fold sizes a gap; the suggestion sizer scales the same ceiling by conviction and can
 *  refuse. A reader given one number and not the other takes the trade the evidence would hold. */
export function renderOrders(
  locale: Locale,
  advice: RebalancePlanReady,
  options: OrderPricing
): readonly string[] {
  if (advice.rebalance.length === 0) {
    return [`${INDENT[1]}${emptyPlanLine(locale, advice)}`]
  }

  const rows = renderOrderRows(locale, advice, options)
  const lines = (group: OrderGroup): readonly string[] =>
    rows.filter((entry) => entry.group === group).map((entry) => `${INDENT[1]}${entry.text}`)
  const hasBuy = advice.rebalance.some((row) => fractionDirection(row.changePctNav) !== 'down')

  return [
    ...groupRows(locale, 'groupBreach', lines('breach')),
    ...groupRows(locale, 'groupDrift', lines('drift')),
    ...(hasBuy ? [`${INDENT[1]}${t(locale, 'trading.render.rebalance.evidenceCheck')}`] : []),
  ]
}

/** One group under its heading. A group with no rows prints no heading. */
function groupRows(
  locale: Locale,
  heading: 'groupBreach' | 'groupDrift',
  lines: readonly string[]
): readonly string[] {
  if (lines.length === 0) {
    return []
  }

  return [`${INDENT[1]}${groupHeading(locale, heading)}`, ...lines]
}

/** The words a group's rows sit under. */
export function groupHeading(locale: Locale, heading: 'groupBreach' | 'groupDrift'): string {
  return t(locale, `trading.render.rebalance.${heading}`)
}

/** Verb first, then what to hand a broker. A weight alone is not an order, so the amount and unit
 *  count lead wherever the surface is allowed to see them. */
function renderOrder(
  locale: Locale,
  row: PositionChange,
  options: {
    readonly context: RenderContext
    readonly sizing: RebalanceSizing | null
    readonly progress: SegmentProgress | undefined
    readonly entryTranchePct?: number
    readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  }
): string {
  const { sizing, progress } = options
  const side = fractionDirection(row.changePctNav) === 'down' ? 'sell' : 'buy'
  // Each line shows the segment's running weight, so several buys in one sleeve read as a climb.
  const seg = progress ?? {
    from: row.currentPctNav,
    to: row.targetPctNav,
    fromExact: row.currentPctNav,
    toExact: row.targetPctNav,
  }
  // Money off the unrounded points, so an opening amount plus this order reaches the closing one.
  const segAmounts =
    sizing === null
      ? {}
      : {
          segFromAmount: formatMoney(locale, seg.fromExact * sizing.navBase, sizing.baseCurrency),
          segToAmount: formatMoney(locale, seg.toExact * sizing.navBase, sizing.baseCurrency),
        }
  const shared = {
    ticker: `${row.instrument.ticker}${renderKindBadge(locale, row.instrumentKind)}`,
    change: formatFixedFraction(locale, Math.abs(row.changePctNav)),
    current: formatFixedFraction(locale, row.currentPctNav),
    target: formatFixedFraction(locale, row.targetPctNav),
    segFrom: formatFixedFraction(locale, seg.from),
    segTo: formatFixedFraction(locale, seg.to),
    ...segAmounts,
    reason: renderChangeReason(locale, row),
    segment: renderDeclaredValue(locale, `trading.segment.${row.segment}`),
  }

  const action =
    sizing === null
      ? undefined
      : sizedAction(locale, row, {
          sizing,
          ...(options.quoteConventions === undefined
            ? {}
            : { quoteConventions: options.quoteConventions }),
        })

  if (action === undefined) {
    return t(locale, `trading.render.rebalance.${side}`, shared)
  }

  return [
    `${SIDE_MARKS[side]} ${action}`,
    ...entryTranche(locale, row, options),
    ...detailLines(locale, { side, shared }, options.context),
  ].join('\n')
}

/** What the order does to the name's weight and to its sleeve, and why - each its own fact, so the
 *  destination decides how many fit on a line. */
function detailLines(
  locale: Locale,
  order: { readonly side: 'buy' | 'sell'; readonly shared: Record<string, string> },
  context: RenderContext
): readonly string[] {
  const { side, shared } = order

  return toFactLines(
    [
      t(locale, 'trading.render.rebalance.detailWeight', shared),
      t(locale, `trading.render.rebalance.${side}Sleeve`, shared),
      shared.reason ?? '',
    ],
    context,
    2
  )
}

/** The first order of a staged buy, in units the venue accepts. A sell states none — the plan sells
 *  the whole sized amount — and neither does an order already down to one lot, which cannot be
 *  staged and would otherwise print a share of a lot no board fills. */
function entryTranche(
  locale: Locale,
  row: PositionChange,
  options: {
    readonly sizing: RebalanceSizing | null
    readonly entryTranchePct?: number
  }
): readonly string[] {
  const { sizing, entryTranchePct } = options

  if (fractionDirection(row.changePctNav) === 'down' || entryTranchePct === undefined) {
    return []
  }

  const size = sizing?.byInstrument.get(buildInstrumentKey(row.instrument))

  if (size === undefined) {
    return []
  }

  const first = floorToLot(size.quantity * entryTranchePct, size.boardLot)

  if (first <= 0 || first >= size.quantity) {
    return []
  }

  return [
    `${INDENT[2]}${t(locale, 'trading.render.rebalance.entryTranche', {
      shares: formatQuantity(locale, first),
    })}`,
  ]
}

/** The one-line order a sized row prints, and what the one-thing pointer quotes: one author so the
 *  pointer can never restate the row. Absent when the row was never sized. */
export function sizedAction(
  locale: Locale,
  row: PositionChange,
  pricing: {
    readonly sizing: RebalanceSizing
    readonly quoteConventions?: ReadonlyMap<MarketRef, QuoteConvention>
  }
): string | undefined {
  const side = fractionDirection(row.changePctNav) === 'down' ? 'sell' : 'buy'
  const size = pricing.sizing.byInstrument.get(buildInstrumentKey(row.instrument))

  if (size === undefined) {
    return undefined
  }

  return t(locale, `trading.render.rebalance.${side}Action`, {
    ticker: `${row.instrument.ticker}${renderKindBadge(locale, row.instrumentKind)}`,
    quantity: formatQuantity(locale, size.quantity),
    amount: formatMoney(locale, size.valueBase, pricing.sizing.baseCurrency),
    price: formatQuotedPrice(locale, size.unitPrice, {
      currency: size.currency,
      ...quotedInOf(pricing.quoteConventions?.get(row.instrument.market)),
    }),
  })
}

function renderChangeReason(locale: Locale, row: PositionChange): string {
  const segment = renderDeclaredValue(locale, `trading.segment.${row.segment}`)
  const { reason } = row

  switch (reason.kind) {
    case 'fill-gap':
      return t(locale, 'trading.render.rebalance.reasonFillGap', { segment })
    case 'core-fill':
      return t(locale, 'trading.render.rebalance.reasonCoreFill', { segment })
    case 'trim':
      return t(locale, 'trading.render.rebalance.reasonTrim')
    case 'weak-signal':
      return t(locale, 'trading.render.rebalance.reasonWeakSignal', {
        signal: formatScoreValue(locale, reason.signal),
        threshold: formatScoreValue(locale, WEAK_HOLDING_SIGNAL_THRESHOLD),
      })
    case 'off-policy':
      return t(locale, 'trading.render.rebalance.reasonOffPolicy', { segment })
    default: {
      const exhaustive: never = reason
      return exhaustive
    }
  }
}

/** A full scale is the absence of a limit, so it earns no line. The scale blends the sleeves, so it
 *  names none of them: each capped sleeve states its own regime in its own caveat. */

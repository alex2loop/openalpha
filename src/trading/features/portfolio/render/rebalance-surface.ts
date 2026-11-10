import type { Locale } from '@/core/types/locale'
import type { AbsoluteRebalancePlan, RebalancePlanReady } from '@/trading/features/portfolio/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { PortfolioFindingKind } from '@/trading/kernel/portfolio-finding'
import { t } from '@/i18n'
import { renderProfileStamp } from '@/trading/features/profile/render'
import { fractionDirection, renderDeclaredValue } from '@/trading/render/format'

import type { RebalanceRenderOptions } from './rebalance'
import {
  renderAfterPlan,
  renderBreachLine,
  renderNavLine,
  renderNotes,
  renderPlanNotes,
  renderPlanTables,
  renderRebalanceTitle,
  renderStanceLines,
} from './rebalance'
import { renderGapEntries } from './rebalance-gaps'
import { emptyPlanLine, groupHeading, renderOrderRows } from './rebalance-orders'

type RebalanceGroup = 'first' | 'later'

/** The ceilings the operator set that the book stands over. An app lays them out beside the
 *  segments against the levels, so the notes leave them out. */
const CEILING_FINDINGS: ReadonlySet<PortfolioFindingKind> = new Set([
  'position-cap-breach',
  'segment-cap-breach',
  'etf-cap-breach',
  'sector-cap-breach',
])

export interface RebalanceText {
  /** The answer first: the plan in one line, what leaving it undone costs, what it leaves behind. */
  readonly headline: readonly string[]
  /** The words the two order groups sit under. */
  readonly groups: { readonly first: string; readonly later: string }
  readonly orders: readonly {
    readonly instrument: InstrumentRef
    readonly group: RebalanceGroup
    readonly line: string
  }[]
  readonly segments: readonly string[]
  /** Where the book stands over a ceiling the operator set: one line each, apart from the notes so
   *  an app can lay them beside the segments. */
  readonly limits: readonly string[]
  readonly notes: readonly string[]
}

type SurfaceOptions = Omit<RebalanceRenderOptions, 'listedOnly'>

/** `/rebalance`'s own lines for an app to lay out: the same functions, with every indent trimmed. */
export function renderRebalanceForSurface(
  locale: Locale,
  plan: AbsoluteRebalancePlan,
  options: SurfaceOptions
): RebalanceText {
  const { advice } = plan

  // A gaps plan has no order groups to head.
  const groups =
    options.form === 'gaps'
      ? { first: '', later: '' }
      : {
          first: groupHeading(locale, 'groupBreach'),
          later: groupHeading(locale, 'groupDrift'),
        }

  const ceilings = advice.findings.filter((finding) => CEILING_FINDINGS.has(finding.kind))
  const rest = advice.findings.filter((finding) => !CEILING_FINDINGS.has(finding.kind))
  const limits = trimmed(renderNotes(locale, ceilings, []))

  if (advice.kind === 'unavailable') {
    return {
      headline: [renderDeclaredValue(locale, `trading.advice.unavailable.${advice.reason}`)],
      groups,
      orders: [],
      segments: [],
      limits,
      notes: trimmed(renderNotes(locale, rest, advice.caveats)),
    }
  }

  const sized = { ...options, sizing: plan.sizing, listedOnly: false }

  return {
    headline: headlineOf(locale, advice, sized),
    groups,
    orders: orderEntries(locale, advice, sized),
    segments: trimmed(renderPlanTables(locale, advice, sized)),
    limits,
    notes: trimmed([
      ...(sized.form === 'gaps' ? [] : orderNotes(locale, advice)),
      ...renderPlanNotes(locale, { ...advice, findings: rest }, sized),
    ]),
  }
}

/** The lines under each group: orders, or only the gaps when the form says so. */
function orderEntries(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): RebalanceText['orders'] {
  if (options.form === 'gaps') {
    return renderGapEntries(locale, advice, options.sizing ?? null).map((entry) => ({
      instrument: entry.row.instrument,
      group: 'later',
      line: trimmedBlock(entry.text),
    }))
  }

  return renderOrderRows(locale, advice, options).map((entry) => ({
    instrument: entry.row.instrument,
    group: entry.group === 'breach' ? 'first' : 'later',
    line: trimmedBlock(entry.text),
  }))
}

/** What stands beside an order list: the sizing caveat and how hard today's plan leans. */
function orderNotes(locale: Locale, advice: RebalancePlanReady): readonly string[] {
  return [
    ...(advice.rebalance.some((row) => fractionDirection(row.changePctNav) !== 'down')
      ? [t(locale, 'trading.render.rebalance.evidenceCheck')]
      : []),
    ...renderStanceLines(locale, advice),
  ]
}

function trimmedBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n')
}

function headlineOf(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  const gaps = options.form === 'gaps'

  return trimmed([
    renderRebalanceTitle(locale, advice, options),
    ...(gaps || advice.rebalance.length > 0 ? [] : [emptyPlanLine(locale, advice)]),
    ...(gaps ? [] : renderBreachLine(locale, advice)),
    ...(gaps ? [] : renderAfterPlan(locale, advice, options)),
    ...renderNavLine(locale, options.sizing ?? null, options),
    renderProfileStamp(locale, advice.policy.profile),
  ])
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}

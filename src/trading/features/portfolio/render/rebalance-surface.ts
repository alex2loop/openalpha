import type { Locale } from '@/core/types/locale'
import type { AbsoluteRebalancePlan, RebalancePlanReady } from '@/trading/features/portfolio/types'
import type { InstrumentRef } from '@/trading/kernel/instrument'
import { t } from '@/i18n'
import { renderProfileStamp } from '@/trading/features/profile/render'
import { fractionDirection, renderDeclaredValue } from '@/trading/render/format'

import type { RebalanceRenderOptions } from './rebalance'
import {
  renderAfterPlan,
  renderBreachLine,
  renderNavLine,
  renderNotes,
  renderRebalanceTitle,
  renderStanceLines,
} from './rebalance'
import { emptyPlanLine, groupHeading, renderOrderRows } from './rebalance-orders'
import { renderCashLine, renderEtfCapLines, renderSleeves } from './sleeves'

type RebalanceGroup = 'first' | 'later'

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
  readonly sleeves: readonly string[]
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
  const groups = {
    first: groupHeading(locale, 'groupBreach'),
    later: groupHeading(locale, 'groupDrift'),
  }

  if (advice.kind === 'unavailable') {
    return {
      headline: [renderDeclaredValue(locale, `trading.advice.unavailable.${advice.reason}`)],
      groups,
      orders: [],
      sleeves: [],
      notes: trimmed(renderNotes(locale, advice.findings, advice.caveats)),
    }
  }

  const sized = { ...options, sizing: plan.sizing, listedOnly: false }

  return {
    headline: headlineOf(locale, advice, sized),
    groups,
    orders: renderOrderRows(locale, advice, sized).map((entry) => ({
      instrument: entry.row.instrument,
      group: entry.group === 'breach' ? 'first' : 'later',
      line: entry.text
        .split('\n')
        .map((line) => line.trimStart())
        .join('\n'),
    })),
    sleeves: trimmed([
      ...renderSleeves(locale, advice.allocation, options.context),
      ...renderEtfCapLines(locale, advice.allocation),
      renderCashLine(locale, advice, plan.sizing),
    ]),
    notes: trimmed([
      ...(advice.rebalance.some((row) => fractionDirection(row.changePctNav) !== 'down')
        ? [t(locale, 'trading.render.rebalance.evidenceCheck')]
        : []),
      ...renderStanceLines(locale, advice),
      ...renderNotes(locale, advice.findings, [...advice.cashSleeve.caveats, ...advice.caveats]),
    ]),
  }
}

function headlineOf(
  locale: Locale,
  advice: RebalancePlanReady,
  options: RebalanceRenderOptions
): readonly string[] {
  return trimmed([
    renderRebalanceTitle(locale, advice, options),
    ...(advice.rebalance.length === 0 ? [emptyPlanLine(locale, advice)] : []),
    ...renderBreachLine(locale, advice),
    ...renderAfterPlan(locale, advice, options),
    ...renderNavLine(locale, options.sizing ?? null, options),
    renderProfileStamp(locale, advice.policy.profile),
  ])
}

function trimmed(lines: readonly string[]): readonly string[] {
  return lines.map((line) => line.trimStart())
}

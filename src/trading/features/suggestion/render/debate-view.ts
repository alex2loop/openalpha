import type { Locale } from '@/core/types/locale'
import type { StoredDebate } from '@/trading/features/suggestion/debate/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { DebateMode, DebateRole } from '@/trading/kernel/config'
import { DEBATE_MODE_ROLES } from '@/trading/kernel/config'
import { renderDeclaredValue } from '@/trading/render/format'

/** One role's stored line. Bull and bear argue a side and state no verdict. */
interface DebateRoleView {
  readonly role: DebateRole
  /** The role's verdict in the operator's language, in the words the report's debate block uses. */
  readonly verdict?: string
  readonly summary: string
}

/** How a stored call was argued, for a surface that lays the roles out itself. The stored debate
 *  keeps no rounds, so `steps` is the roles the mode runs; claims carry no side. */
export interface DebateView {
  readonly mode: DebateMode
  readonly steps: number
  readonly createdAt: number
  readonly strategyVersion: string
  readonly evidenceThrough?: string
  readonly roles: readonly DebateRoleView[]
  readonly claims: readonly { readonly id: string; readonly text: string }[]
  /** Empty on a call stored before refuted ids were kept. */
  readonly refutedIds: readonly string[]
  readonly models: readonly string[]
}

/** `undefined` for a call with no readable debate block: a reduce the plan made, or a block this
 *  build could not parse. */
export function toDebateView(locale: Locale, suggestion: StoredSuggestion): DebateView | undefined {
  const { debate } = suggestion

  if (debate === undefined) {
    return undefined
  }

  return {
    mode: debate.mode,
    steps: DEBATE_MODE_ROLES[debate.mode].length,
    createdAt: suggestion.createdAt,
    strategyVersion: suggestion.strategyVersion,
    ...(suggestion.evidenceThrough === undefined
      ? {}
      : { evidenceThrough: suggestion.evidenceThrough }),
    roles: rolesOf(locale, debate),
    claims: debate.claims.map(({ id, text }) => ({ id, text })),
    refutedIds: [...(debate.refutedIds ?? [])],
    models: [...debate.models],
  }
}

function rolesOf(locale: Locale, debate: StoredDebate): readonly DebateRoleView[] {
  if (debate.mode === 'lean') {
    return [
      {
        role: 'market-analyst',
        verdict: renderDeclaredValue(locale, `trading.debate.stance.${debate.analystStance}`),
        summary: debate.analystSummary,
      },
    ]
  }

  return [
    { role: 'bull-researcher', summary: debate.bullSummary },
    { role: 'bear-researcher', summary: debate.bearSummary },
    {
      role: 'portfolio-manager',
      verdict: renderDeclaredValue(locale, `trading.debate.manager.${debate.managerVerdict}`),
      summary: debate.managerRationale,
    },
    {
      role: 'trader',
      verdict: renderDeclaredValue(locale, `trading.debate.trader.${debate.traderStance}`),
      summary: debate.traderTiming,
    },
    {
      role: 'risk-analyst',
      verdict: renderDeclaredValue(locale, `trading.debate.risk.${debate.riskVerdict}`),
      summary: debate.riskNote ?? '',
    },
  ]
}

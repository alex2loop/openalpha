import type { Locale } from '@/core/types/locale'
import type { ArguingRole } from '@/trading/features/suggestion/debate/claims'
import type { RoleOutput, StoredDebate } from '@/trading/features/suggestion/debate/types'
import type { StoredSuggestion } from '@/trading/features/suggestion/types'
import type { DebateMode, DebateRole } from '@/trading/kernel/config'
import { isUnsupportedRole } from '@/trading/features/suggestion/debate/claims'
import { DEBATE_MODE_ROLES } from '@/trading/kernel/config'
import { renderDeclaredValue } from '@/trading/render/format'

/** The catalog family each role words its stance in. The verifier concludes no stance. */
const STANCE_FAMILIES: Readonly<Partial<Record<DebateRole, string>>> = Object.freeze({
  'bull-researcher': 'stance',
  'bear-researcher': 'stance',
  'market-analyst': 'stance',
  'portfolio-manager': 'manager',
  trader: 'trader',
  'risk-analyst': 'risk',
})

/** One role's stored line. Bull and bear argue a side and state no verdict. */
interface DebateRoleView {
  readonly role: DebateRole
  /** The role's verdict in the operator's language, in the words the report's debate block uses. */
  readonly verdict?: string
  /** Absent where there is nothing to show: a risk analyst with no note, or a case the evidence
   *  refuted whole. */
  readonly summary?: string
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
  const refuted = new Set(debate.refutedIds ?? [])
  // What the live `role_output` withholds is withheld here too: a case the evidence refuted whole.
  const argued = (role: ArguingRole, summary: string): { readonly summary?: string } =>
    isUnsupportedRole(role, debate.claims, refuted) ? {} : { summary }

  if (debate.mode === 'lean') {
    return [
      toRoleView(locale, 'market-analyst', {
        stance: debate.analystStance,
        ...argued('market-analyst', debate.analystSummary),
      }),
    ]
  }

  return [
    toRoleView(locale, 'bull-researcher', argued('bull-researcher', debate.bullSummary)),
    toRoleView(locale, 'bear-researcher', argued('bear-researcher', debate.bearSummary)),
    toRoleView(locale, 'portfolio-manager', {
      stance: debate.managerVerdict,
      summary: debate.managerRationale,
    }),
    toRoleView(locale, 'trader', { stance: debate.traderStance, summary: debate.traderTiming }),
    toRoleView(locale, 'risk-analyst', {
      stance: debate.riskVerdict,
      ...(debate.riskNote === undefined ? {} : { summary: debate.riskNote }),
    }),
  ]
}

function toRoleView(
  locale: Locale,
  role: DebateRole,
  parts: Pick<RoleOutput, 'stance' | 'summary'>
): DebateRoleView {
  const verdict = renderRoleStance(locale, { role, ...parts })

  return {
    role,
    ...(verdict === undefined ? {} : { verdict }),
    ...(parts.summary === undefined ? {} : { summary: parts.summary }),
  }
}

/** The role's stance in the operator's language, in the words the debate view uses; absent for a
 *  role that concluded none. */
export function renderRoleStance(
  locale: Locale,
  output: Pick<RoleOutput, 'role' | 'stance'>
): string | undefined {
  const family = STANCE_FAMILIES[output.role]

  if (family === undefined || output.stance === undefined) {
    return undefined
  }

  return renderDeclaredValue(locale, `trading.debate.${family}.${output.stance}`)
}

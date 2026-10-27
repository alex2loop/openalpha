import type { MessageKey } from '@/i18n'
import type { ActorId, Rect, RoleId } from '@/web/scene/types'
import { isCrewId, ownAgentIdOf, rosterDefOf } from '@/web/scene/sim/actors/roster'
import { agents } from '@/web/state/agents'
import { locale } from '@/web/state/session'
import { TRUNCATION_MARK } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** Each role's name: debate roles by the daemon's own names, the rest by the office's. */
const ROLE_NAME_KEYS: Readonly<Record<RoleId, MessageKey>> = Object.freeze({
  'bull-researcher': 'trading.debate.role.bull-researcher',
  'bear-researcher': 'trading.debate.role.bear-researcher',
  'portfolio-manager': 'trading.debate.role.portfolio-manager',
  trader: 'trading.debate.role.trader',
  'risk-analyst': 'trading.debate.role.risk-analyst',
  'claim-verifier': 'trading.debate.role.claim-verifier',
  'market-analyst': 'trading.debate.role.market-analyst',
  planner: 'ui.office.role.planner',
  crawler: 'ui.office.role.crawler',
  reviewer: 'ui.office.role.reviewer',
  synth: 'ui.office.role.synth',
  theme: 'ui.office.role.theme',
  keeper: 'ui.office.role.keeper',
  assistant: 'ui.office.role.assistant',
  clerk: 'ui.office.role.clerk',
  receptionist: 'ui.office.crew.receptionist',
  guard: 'ui.office.crew.guard',
  cleaner: 'ui.office.crew.cleaner',
} satisfies Record<RoleId, MessageKey>)

/** A placed name tag: under its person's feet; `isMore` when its bubble found no room. */
export interface PlacedTag {
  readonly actor: ActorId
  readonly text: string
  readonly rect: Rect
  readonly isSelected: boolean
  readonly isMore: boolean
}

export function roleNameOf(role: RoleId): string {
  return tr(ROLE_NAME_KEYS[role])
}

/** The role's name as a title: the daemon writes debate roles in lower case, for use mid-line. */
export function roleTitleOf(role: RoleId): string {
  const name = roleNameOf(role)

  return `${name.charAt(0).toLocaleUpperCase(locale.value)}${name.slice(1)}`
}

/** A person's tag text: the role's name, an own agent's name, or "temp - role" for a child given
 *  `childRole`; and "..." when its bubble is hidden for room. */
export function tagTextOf(actor: ActorId, isMore: boolean, childRole?: string): string {
  const name =
    childRole === undefined ? nameOf(actor) : tr('ui.office.role.child', { role: childRole })

  return isMore ? `${name} ${TRUNCATION_MARK}` : name
}

function nameOf(actor: ActorId): string {
  const def = isCrewId(actor) ? { role: actor } : rosterDefOf(actor)
  const agentId = ownAgentIdOf(actor)

  if (def !== undefined) {
    return roleNameOf(def.role)
  }

  return agents.value.find((agent) => agent.id === agentId)?.name ?? agentId ?? ''
}

/** The placed tags; clicks reach them through the canvas's hit test, so they take no pointer. */
export function NameTags({ tags }: { readonly tags: readonly PlacedTag[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag.actor}
          class={tag.isSelected ? 'name-tag glass is-flat is-selected' : 'name-tag glass is-flat'}
          style={{ left: `${tag.rect.x}px`, top: `${tag.rect.y}px` }}
        >
          {tag.text}
        </span>
      ))}
    </>
  )
}

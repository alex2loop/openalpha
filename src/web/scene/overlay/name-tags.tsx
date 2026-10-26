import type { MessageKey } from '@/i18n'
import type { ActorId, ActorStatus, Rect, RoleId } from '@/web/scene/types'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { locale } from '@/web/state/session'
import { joinInline, TRUNCATION_MARK } from '@/web/text/glyphs'
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
} satisfies Record<RoleId, MessageKey>)

/** What the dot over a head means, in words, so its colour is never the only cue. */
const STATUS_KEYS: Readonly<Record<ActorStatus, MessageKey>> = Object.freeze({
  free: 'ui.office.status.free',
  waiting: 'ui.office.status.waiting',
  failed: 'ui.office.status.failed',
} satisfies Record<ActorStatus, MessageKey>)

/** A placed name tag: under its person's feet; `isMore` when its bubble found no room. */
export interface PlacedTag {
  readonly actor: ActorId
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

/** The hovered person's label: the role's name and what their dot means, when they show one. */
export function hoverTextOf(actor: ActorId, status: ActorStatus | undefined): string {
  const name = tagTextOf(actor, false)

  return status === undefined ? name : joinInline([name, tr(STATUS_KEYS[status])])
}

/** A person's tag text: the role's name, and "..." when its bubble is hidden for room. */
export function tagTextOf(actor: ActorId, isMore: boolean): string {
  const def = ROSTER.find((held) => held.id === actor)
  const name = def === undefined ? '' : roleNameOf(def.role)

  return isMore ? `${name} ${TRUNCATION_MARK}` : name
}

/** The placed tags; clicks reach them through the canvas's hit test, so they take no pointer. */
export function NameTags({ tags }: { readonly tags: readonly PlacedTag[] }) {
  return (
    <>
      {tags.map((tag) => (
        <span
          key={tag.actor}
          class={tag.isSelected ? 'name-tag glass is-selected' : 'name-tag glass'}
          style={{ left: `${tag.rect.x}px`, top: `${tag.rect.y}px` }}
        >
          {tagTextOf(tag.actor, tag.isMore)}
        </span>
      ))}
    </>
  )
}

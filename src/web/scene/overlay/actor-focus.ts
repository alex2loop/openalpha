import type { Director } from '@/web/scene/sim/director'
import type { ActorId, ActorView, Point, SimView } from '@/web/scene/types'
import { actorNowOf, actorRunOf } from '@/web/scene/overlay/actor-state'
import { sayAs } from '@/web/scene/overlay/bubbles'
import { hoverTextOf, personNameOf, replyTextOf } from '@/web/scene/overlay/hover-label'
import { announce, hoverActor, keyActor, keyedActor } from '@/web/scene/overlay/overlay'
import { closeMenu, menuActionsFor, openMenu } from '@/web/scene/overlay/radial-menu'
import { ownAgentIdOf, ROSTER } from '@/web/scene/sim/actors/roster'
import { STREET_FIGURE_H } from '@/web/scene/street-types'
import { FIGURE } from '@/web/scene/types'
import { centerOn, keepFollowing, startFollow, stopFollow, view } from '@/web/scene/view'
import { STREET_DOOR } from '@/web/scene/world/doors'
import { selectActor } from '@/web/state/focus'
import { tr } from '@/web/text/tr'
import { BELL_POPOVER_ID, openPopover } from '@/web/ui/kit/popover'

/** What reacting to and stepping through people reads and drives. */
export interface FocusDeps {
  readonly canvas: HTMLCanvasElement
  readonly readView: () => SimView
  readonly director: Director
  readonly wake: () => void
}

/** How a person was reached: `isFocused` moves focus into the ring, `withMenu` opens it. */
interface Reach {
  readonly actor: ActorId
  readonly isFocused: boolean
  readonly withMenu: boolean
}

/** A click, a right-click, Enter or a long-press on a person: they wave when free or glance up
 *  when busy, answer from what they really do, then the ring opens (or the bell, for one waiting
 *  at your desk). */
export function engage(deps: FocusDeps, reach: Reach): void {
  const sim = deps.readView()
  const { actor } = reach
  const now = actorNowOf(sim, actor)
  const isFree = now.kind === 'dot' || now.kind === 'life' || now.kind === 'errand'

  deps.director.requestReaction(actor, isFree ? 'greet' : 'busy-glance')
  sayAs(actor, replyTextOf(now))
  selectActor(actor)
  deps.wake()

  if (now.kind === 'asking' && now.isAtDesk) {
    closeMenu(false)
    openPopover(BELL_POPOVER_ID)
    return
  }

  if (!reach.withMenu) {
    return
  }

  const run = actorRunOf(actor)
  const parentAgentId = sim.team.children.find((child) => child.actor === actor)?.parentAgentId

  openMenu({
    actor,
    name: personNameOf(sim, actor),
    actions: [
      ...menuActionsFor(actor, {
        now,
        ...(run === undefined ? {} : { run }),
        ...(parentAgentId === undefined ? {} : { parentAgentId }),
      }),
      // The double click's follow, for the keyboard and touch.
      { id: 'follow', run: () => followActor(deps, actor) },
    ],
    isFocused: reach.isFocused,
    canvas: deps.canvas,
  })
}

/** Tab, Shift+Tab and the side arrows: the next person on the floor shown, left to right. Past
 *  either end Tab leaves the canvas (false) where an arrow wraps round. */
export function stepFocus(deps: FocusDeps, step: { by: 1 | -1; isWrapping: boolean }): boolean {
  const list = orderOn(deps.readView())
  const held = keyedActor.value
  const at = held === undefined ? -1 : list.findIndex((actor) => actor.id === held)
  const before = step.by > 0 ? -1 : list.length
  const start = at >= 0 ? at : before
  const index = start + step.by
  const isPast = index < 0 || index >= list.length

  if (isPast && (!step.isWrapping || list.length === 0)) {
    leaveFocus(deps)
    return false
  }

  const next = list[(index + list.length) % list.length]

  if (next !== undefined) {
    focusOn(deps, next)
  }

  return true
}

/** The keyboard leaves the people: the look it asked for and its label end. */
export function leaveFocus(deps: FocusDeps): void {
  const held = keyedActor.value

  if (held !== undefined) {
    deps.director.requestReaction(held, undefined)
    keyActor(undefined)
    hoverActor(undefined)
    deps.wake()
  }
}

/** A double click: the camera keeps the person centred, across floors, until the operator moves
 *  it. */
export function followActor(deps: FocusDeps, actor: ActorId): void {
  const sim = deps.readView()
  const held = sim.actors.find((each) => each.id === actor)

  if (held === undefined) {
    return
  }

  closeMenu(false)
  startFollow(actor, { floor: held.floor, point: chestOf(held) })
  announce(tr('ui.office.follow.on', { name: personNameOf(sim, actor) }))
}

/** One drawn frame of a follow: the camera keeps the person where the frame draws them, and lets
 *  go of one who left. */
export function frameFollow(sim: SimView): void {
  const actor = view.value.follow

  if (actor === undefined) {
    return
  }

  const held = sim.actors.find((each) => each.id === actor)

  if (held === undefined) {
    stopFollow()
    return
  }

  const at = {
    x: held.prev.x + (held.at.x - held.prev.x) * sim.alpha,
    y: held.prev.y + (held.at.y - held.prev.y) * sim.alpha,
  }

  keepFollowing({ floor: held.floor, point: chestOf({ ...held, at }) })
}

function focusOn(deps: FocusDeps, actor: ActorView): void {
  const sim = deps.readView()
  const held = keyedActor.value

  if (held !== undefined && held !== actor.id) {
    deps.director.requestReaction(held, undefined)
  }

  stopFollow()
  closeMenu(false)
  keyActor(actor.id)
  hoverActor(actor.id)
  centerOn(actor.errand?.isOut === true ? chestOf({ at: STREET_DOOR }) : chestOf(actor))
  deps.director.requestReaction(actor.id, 'look')
  announce(hoverTextOf(personNameOf(sim, actor.id), actorNowOf(sim, actor.id), Date.now()))
  deps.wake()
}

// A fixed order, so people who walk never reorder it: the office crew by roster, own agents by
// their desk, children by id.
function orderOn(sim: SimView): ActorView[] {
  return sim.actors
    .filter((actor) => actor.floor === sim.floor && actor.isAway !== true)
    .map((actor) => ({ actor, rank: rankOf(sim, actor.id) }))
    .sort((a, b) => a.rank - b.rank || a.actor.id.localeCompare(b.actor.id))
    .map((held) => held.actor)
}

function rankOf(sim: SimView, actor: ActorId): number {
  const staff = ROSTER.findIndex((def) => def.id === actor)
  const agentId = ownAgentIdOf(actor)
  const slot = sim.team.desks.findIndex((desk) => agentId !== undefined && desk.agentId === agentId)

  if (staff >= 0) {
    return staff
  }

  return slot >= 0 ? ROSTER.length + slot : ROSTER.length + sim.team.desks.length
}

// Half a figure above the feet: an office figure's, or the smaller street one while out.
function chestOf(actor: Pick<ActorView, 'at' | 'errand'>): Point {
  const height = actor.errand?.isOut === true ? STREET_FIGURE_H : FIGURE.h

  return { x: actor.at.x, y: actor.at.y - height / 2 }
}

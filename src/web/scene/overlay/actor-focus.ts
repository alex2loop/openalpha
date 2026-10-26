import type { Director } from '@/web/scene/sim/director'
import type { ActorId, ActorView, Point, SimView } from '@/web/scene/types'
import { actorNowOf, actorRunOf } from '@/web/scene/overlay/actor-state'
import { sayAs } from '@/web/scene/overlay/bubbles'
import { hoverTextOf, personNameOf, replyTextOf } from '@/web/scene/overlay/hover-label'
import { announce, hoverActor, keyActor, keyedActor } from '@/web/scene/overlay/overlay'
import { closeMenu, menuActionsFor, openMenu } from '@/web/scene/overlay/radial-menu'
import { FIGURE } from '@/web/scene/types'
import { centerOn, keepFollowing, startFollow, stopFollow, view } from '@/web/scene/view'
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
  const isFree = now.kind === 'dot' || now.kind === 'life'

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
  const parentAgentId = sim.team.kids.find((kid) => kid.actor === actor)?.parentAgentId

  openMenu({
    actor,
    name: personNameOf(sim, actor),
    actions: menuActionsFor(actor, {
      now,
      ...(run === undefined ? {} : { run }),
      ...(parentAgentId === undefined ? {} : { parentAgentId }),
    }),
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

/** One sim step of a follow: the camera keeps up with its person, and lets go of one who left. */
export function stepFollow(sim: SimView): void {
  const actor = view.value.follow

  if (actor === undefined) {
    return
  }

  const held = sim.actors.find((each) => each.id === actor)

  if (held === undefined) {
    stopFollow()
    return
  }

  keepFollowing({ floor: held.floor, point: chestOf(held) })
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
  centerOn(chestOf(actor))
  deps.director.requestReaction(actor.id, 'look')
  announce(hoverTextOf(personNameOf(sim, actor.id), actorNowOf(sim, actor.id), Date.now()))
  deps.wake()
}

function orderOn(sim: SimView): ActorView[] {
  return sim.actors
    .filter((actor) => actor.floor === sim.floor)
    .sort((a, b) => a.at.x - b.at.x || a.at.y - b.at.y)
}

function chestOf(actor: ActorView): Point {
  return { x: actor.at.x, y: actor.at.y - FIGURE.h / 2 }
}

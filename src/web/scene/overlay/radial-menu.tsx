import { computed, type ReadonlySignal, signal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { MessageKey } from '@/i18n'
import type { ActorNow } from '@/web/scene/overlay/actor-state'
import type { ActorId, Rect, Size } from '@/web/scene/types'
import type { Run } from '@/web/state/live'
import { overlayView } from '@/web/scene/overlay/overlay'
import { ASSISTANT, ownAgentIdOf } from '@/web/scene/sim/actors/roster'
import { projection } from '@/web/scene/view'
import { selectAgent } from '@/web/state/agents'
import { setChatOpen } from '@/web/state/chat'
import { fillInput } from '@/web/state/command'
import { hasChildren } from '@/web/state/live'
import { type AgentSection, openView } from '@/web/state/panel'
import { tr } from '@/web/text/tr'
import { askStop } from '@/web/ui/kit/ask-stop'
import { ESCAPE_KEY } from '@/web/ui/kit/focus-trap'

import './radial-menu.css'

// The ring's half width and height round the person, and a pill's half size, in CSS px.
const RING_RX_PX = 96
const RING_RY_PX = 60
const PILL_HALF_W_PX = 64
const PILL_HALF_H_PX = 15
const STEP_KEYS: Readonly<Record<string, 1 | -1>> = Object.freeze({
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
})
// The built-in people with a tab of their own: the assistant's desk and the alert desk.
const STAFF_TABS: ReadonlySet<ActorId> = new Set(['assistant', 'clerk'])

type MenuActionId = 'chat' | 'task' | 'now' | 'work' | 'stop' | 'profile' | 'follow'

const ACTION_KEYS = Object.freeze({
  chat: 'ui.office.chat.title',
  task: 'ui.office.menu.task',
  now: 'ui.office.menu.now',
  work: 'ui.office.agent.work',
  stop: 'ui.office.menu.stop',
  profile: 'ui.office.agent.profile',
  follow: 'ui.office.menu.follow',
} satisfies Record<MenuActionId, MessageKey>)

/** One thing the operator can do with a person now. */
interface MenuAction {
  readonly id: MenuActionId
  readonly run: () => void
}

/** What a person does now, the run behind it, and a child's parent agent. */
interface MenuContext {
  readonly now: ActorNow
  readonly run?: Run
  readonly parentAgentId?: string
}

interface OpenMenu {
  readonly actor: ActorId
  readonly name: string
  readonly actions: readonly MenuAction[]
  /** Opened from the keyboard, a right-click or a long-press: its first pill takes focus. */
  readonly isFocused: boolean
  /** Where focus goes back when Esc closes it. */
  readonly canvas: HTMLElement
  readonly seq: number
}

const opened = signal<OpenMenu | undefined>(undefined)
let menuSeq = 0

/** The person whose ring is open, for the overlay to place it round them. */
export const menuActor: ReadonlySignal<ActorId | undefined> = computed(() => opened.value?.actor)

/** Only what can be done with the person now: talk to and give work to an own agent or the
 *  assistant (not while paused), its steps and work, stop a run under way, an own agent's
 *  profile. */
export function menuActionsFor(actor: ActorId, context: MenuContext): readonly MenuAction[] {
  const agentId = ownAgentIdOf(actor)
  const canTalk = agentId !== undefined || actor === ASSISTANT
  const tab = agentId ?? context.parentAgentId ?? (STAFF_TABS.has(actor) ? actor : undefined)
  const { run } = context
  const actions: (MenuAction | undefined)[] = [
    canTalk ? { id: 'chat', run: () => openChat(agentId) } : undefined,
    canTalk && context.now.kind !== 'paused'
      ? { id: 'task', run: () => giveWork(agentId) }
      : undefined,
    tab === undefined ? undefined : { id: 'now', run: () => openTab(tab, 'progress') },
    canTalk && tab !== undefined ? { id: 'work', run: () => openTab(tab, 'work') } : undefined,
    run === undefined ? undefined : { id: 'stop', run: () => askStop(run, hasChildren(run.runId)) },
    agentId === undefined ? undefined : { id: 'profile', run: () => openTab(agentId, 'profile') },
  ]

  return actions.filter((action): action is MenuAction => action !== undefined)
}

/** Where the open ring stands: round its person's figure, when they are on screen. */
export function menuPlaceOf(
  figures: ReadonlyMap<ActorId, Rect>,
  actor: ActorId | undefined
): { readonly menu?: { readonly actor: ActorId; readonly rect: Rect } } {
  const figure = actor === undefined ? undefined : figures.get(actor)

  return actor === undefined || figure === undefined ? {} : { menu: { actor, rect: figure } }
}

/** Opens the ring round `actor`; a person with nothing to do now gets none. */
export function openMenu(spec: Omit<OpenMenu, 'seq'>): void {
  if (spec.actions.length === 0) {
    closeMenu(false)
    return
  }

  menuSeq++
  opened.value = { ...spec, seq: menuSeq }
}

/** Closes the ring; `refocus` hands focus back to the canvas. */
export function closeMenu(refocus: boolean): void {
  const held = opened.value

  if (held === undefined) {
    return
  }

  opened.value = undefined

  if (refocus) {
    held.canvas.focus({ preventScroll: true })
  }
}

/** The ring of pills round the person, laid out evenly; arrows cycle them, Esc or focus leaving
 *  closes it. */
export function RadialMenu() {
  const menu = opened.value
  const anchor = overlayView.value.menu

  if (menu === undefined || anchor === undefined || anchor.actor !== menu.actor) {
    return null
  }

  return <MenuRing menu={menu} figure={anchor.rect} />
}

function MenuRing({ menu, figure }: { readonly menu: OpenMenu; readonly figure: Rect }) {
  const host = useRef<HTMLDivElement>(null)
  const center = ringCenterOf(figure, projection.value.pane)
  const count = menu.actions.length

  useEffect(() => {
    if (menu.isFocused) {
      host.current?.querySelector('button')?.focus({ preventScroll: true })
    }
  }, [menu.seq])

  return (
    <div
      ref={host}
      class="radial-menu"
      role="menu"
      aria-label={tr('ui.office.menu.title', { name: menu.name })}
      onKeyDown={(event) => onMenuKey(event, host.current)}
      onFocusOut={(event) => onFocusLeave(event, host.current)}
    >
      {menu.actions.map((action, index) => (
        <button
          key={action.id}
          type="button"
          role="menuitem"
          class="radial-menu-pill"
          style={pillStyle(center, { index, count })}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => pick(action)}
        >
          {tr(ACTION_KEYS[action.id])}
        </button>
      ))}
    </div>
  )
}

// Focus goes back to the canvas first; an action that opens somewhere (the input) takes it on.
function pick(action: MenuAction): void {
  closeMenu(true)
  action.run()
}

function onMenuKey(event: KeyboardEvent, host: HTMLElement | null): void {
  if (event.key === ESCAPE_KEY) {
    event.preventDefault()
    event.stopPropagation()
    closeMenu(true)
    return
  }

  const step = STEP_KEYS[event.key]
  const pills = host === null ? [] : [...host.querySelectorAll('button')]

  if (step === undefined || pills.length === 0) {
    return
  }

  event.preventDefault()

  const active = document.activeElement
  const at = active instanceof HTMLButtonElement ? pills.indexOf(active) : -1
  const next = (at + step + pills.length) % pills.length

  pills[next]?.focus({ preventScroll: true })
}

function onFocusLeave(event: FocusEvent, host: HTMLElement | null): void {
  const next = event.relatedTarget

  if (host !== null && !(next instanceof Node && host.contains(next))) {
    closeMenu(false)
  }
}

// The ring's middle at the person's chest, kept far enough inside the pane for every pill.
function ringCenterOf(figure: Rect, pane: Size): { x: number; y: number } {
  const rx = ringRxOf(pane)
  const x = figure.x + figure.w / 2
  const y = figure.y + figure.h / 2

  return {
    x: Math.min(pane.w - rx - PILL_HALF_W_PX, Math.max(rx + PILL_HALF_W_PX, x)),
    y: Math.min(pane.h - RING_RY_PX - PILL_HALF_H_PX, Math.max(RING_RY_PX + PILL_HALF_H_PX, y)),
  }
}

function ringRxOf(pane: Size): number {
  return Math.max(0, Math.min(RING_RX_PX, pane.w / 2 - PILL_HALF_W_PX))
}

// The first pill at the top, the rest evenly round the ring clockwise.
function pillStyle(
  center: { x: number; y: number },
  at: { readonly index: number; readonly count: number }
): Record<string, string> {
  const angle = -Math.PI / 2 + (at.index * 2 * Math.PI) / at.count
  const rx = ringRxOf(projection.value.pane)

  return {
    left: `${Math.round(center.x + Math.cos(angle) * rx)}px`,
    top: `${Math.round(center.y + Math.sin(angle) * RING_RY_PX)}px`,
  }
}

// Talking to someone picks them in the who-chip (no AI cost) and opens the chat.
function openChat(agentId: string | undefined): void {
  selectAgent(agentId)
  setChatOpen(true)
}

// The empty box waits for what the operator types; nothing is sent.
function giveWork(agentId: string | undefined): void {
  selectAgent(agentId)
  fillInput('')
}

function openTab(agentId: string, section: AgentSection): void {
  openView({ agent: agentId, section })
}

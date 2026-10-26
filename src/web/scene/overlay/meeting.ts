import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { ActorState, Director } from '@/web/scene/sim/director'
import type { Goal } from '@/web/scene/sim/vocabulary'
import type { ActorId, FloorId, Point, Rect, RoomId, ScreenPoint, SimView } from '@/web/scene/types'
import type { Turn } from '@/web/state/chat'
import { pluralKey } from '@/i18n'
import { tagTextOf } from '@/web/scene/overlay/name-tags'
import { ROSTER } from '@/web/scene/sim/actors/roster'
import { MEET_AUDIENCE } from '@/web/scene/world/seats'
import { isFinished, thread } from '@/web/state/chat'
import { fillInput, SUGGEST_COMMAND } from '@/web/state/command'
import { onWireEvent } from '@/web/state/events'
import { joinList } from '@/web/text/glyphs'
import { tr } from '@/web/text/tr'

/** The meeting room's floor: only its people are picked for a meeting. */
export const MEET_FLOOR: FloorId = 'office'
const MEET_ROOM: RoomId = 'meet'
// A box smaller than this on both sides was a click, not a drag.
const BOX_MIN_PX = 5
const AUDIENCE_POSE = 'watch'
// A ring under the feet is this much as tall as it is wide.
const RING_ASPECT = 0.4

/** What the meeting bar shows: the people picked, the hint the room offers, a note on the last
 *  meeting, and the box a Shift-drag draws (CSS px of the scene host). */
interface Picking {
  readonly picks: readonly ActorId[]
  readonly isHinted: boolean
  readonly note?: string
  readonly box?: Rect
}

/** The one meeting the operator called: filled into the input, and once its run starts, who sat
 *  in and the listeners waiting for its turn and its end. */
interface PendingMeeting {
  readonly filledAt: number
  readonly picks: readonly ActorId[]
  readonly offs: (() => void)[]
  runId?: string
  audience: readonly ActorId[]
}

interface MeetingDeps {
  readonly director: Director
  readonly wake: () => void
}

interface MeetingState {
  readonly deps: MeetingDeps
  pending: PendingMeeting | undefined
  boxFrom: ScreenPoint | undefined
}

/** Picking people and the meeting they are called to; `dispose` sends any audience back. */
export interface Meeting {
  toggle(sim: SimView, actor: ActorId): void
  startBox(at: ScreenPoint): void
  moveBox(at: ScreenPoint): void
  /** Picks everyone on the meeting floor whose feet stand in the box; false when the box was too
   *  small to be one (a Shift-click). */
  endBox(sim: SimView, toScreen: (point: Point) => ScreenPoint): boolean
  cancelBox(): void
  showHint(): void
  /** Drops the picks, the hint and the note, never a meeting under way; true when there was any. */
  clearPicks(): boolean
  dispose(): void
}

const picking = signal<Picking>({ picks: [], isHinted: false })
// The meeting the bar's buttons act on: the mounted scene's.
let current: MeetingState | undefined

export const meetingBar: ReadonlySignal<Picking> = picking

export function createMeeting(deps: MeetingDeps): Meeting {
  const state: MeetingState = { deps, pending: undefined, boxFrom: undefined }

  current = state

  return {
    toggle: (sim, actor) => toggle(state, { sim, actor }),
    startBox: (at) => {
      state.boxFrom = at
      setPicking({ box: boxOf(at, at) })
    },
    moveBox: (at) => {
      if (state.boxFrom !== undefined) {
        setPicking({ box: boxOf(state.boxFrom, at) })
      }
    },
    endBox: (sim, toScreen) => endBox(state, { sim, toScreen }),
    cancelBox: () => {
      state.boxFrom = undefined
      setPicking({ box: undefined })
    },
    showHint: () => setPicking({ isHinted: true }),
    clearPicks: () => clearPicks(),
    dispose: () => {
      clearAll(state)

      if (current === state) {
        current = undefined
      }
    },
  }
}

/** A ring under the feet of each person picked, and of the one the keyboard is on (`isKey`), by
 *  their figures in CSS px. */
export function ringsOf(
  figures: ReadonlyMap<ActorId, Rect>,
  at: { readonly picks: readonly ActorId[]; readonly keyed?: ActorId }
): { readonly actor: ActorId; readonly rect: Rect; readonly isKey: boolean }[] {
  const actors = new Set([...at.picks, ...(at.keyed === undefined ? [] : [at.keyed])])

  return [...actors].flatMap((actor) => {
    const figure = figures.get(actor)

    if (figure === undefined) {
      return []
    }

    const h = figure.w * RING_ASPECT
    const rect = { x: figure.x, y: figure.y + figure.h - h / 2, w: figure.w, h }

    return [{ actor, rect, isKey: !at.picks.includes(actor) }]
  })
}

/** "Gọi họp": `/suggest <ticker>` goes into the input for the operator to send; nothing is sent.
 *  When its run starts, the picks who are free then walk in. */
export function callMeeting(ticker: string): void {
  const state = current

  if (state === undefined) {
    return
  }

  endMeeting(state)
  fillInput(`${SUGGEST_COMMAND} ${ticker}`)

  const pending: PendingMeeting = {
    filledAt: performance.now(),
    picks: picking.value.picks,
    offs: [],
    audience: [],
  }

  state.pending = pending
  pending.offs.push(effect(() => watchTurns(state, pending, thread.value)))
  setPicking({ note: tr('ui.office.meet.note', { ticker }) })
}

/** "Bỏ chọn": the picks, the hint and any meeting go. */
export function clearMeeting(): void {
  if (current !== undefined) {
    clearAll(current)
  }
}

/** Someone the operator may pick: a built-in person on the meeting floor. */
function isPickable(sim: SimView, actor: ActorId): boolean {
  const held = sim.actors.find((each) => each.id === actor)

  return held?.floor === MEET_FLOOR && ROSTER.some((def) => def.id === actor)
}

function toggle(state: MeetingState, at: { readonly sim: SimView; readonly actor: ActorId }): void {
  const { actor } = at

  if (!isPickable(at.sim, actor)) {
    return
  }

  const { picks } = picking.value
  const next = picks.includes(actor) ? picks.filter((held) => held !== actor) : [...picks, actor]

  pickAnew(state, next)
}

function endBox(
  state: MeetingState,
  at: { readonly sim: SimView; readonly toScreen: (point: Point) => ScreenPoint }
): boolean {
  const box = picking.value.box

  state.boxFrom = undefined
  setPicking({ box: undefined })

  if (box === undefined || (box.w < BOX_MIN_PX && box.h < BOX_MIN_PX)) {
    return false
  }

  const inside = at.sim.actors
    .filter((actor) => isPickable(at.sim, actor.id) && isWithin(box, at.toScreen(actor.at)))
    .map((actor) => actor.id)

  pickAnew(state, [...new Set([...picking.value.picks, ...inside])])

  return true
}

// A new pick ends the meeting already called.
function pickAnew(state: MeetingState, picks: readonly ActorId[]): void {
  endMeeting(state)
  setPicking({ picks, note: undefined })
}

function clearPicks(): boolean {
  const held = picking.value
  const isAny = held.picks.length > 0 || held.isHinted || held.note !== undefined

  setPicking({ picks: [], isHinted: false, note: undefined })

  return isAny
}

function clearAll(state: MeetingState): void {
  endMeeting(state)
  state.boxFrom = undefined
  picking.value = { picks: [], isHinted: false }
}

// The operator's first `/suggest` after the fill is the meeting's: its run starts the meeting; a
// turn that ends without one calls it off.
function watchTurns(state: MeetingState, pending: PendingMeeting, turns: readonly Turn[]): void {
  const turn = turns.find(
    (held) => held.text.startsWith(`${SUGGEST_COMMAND} `) && held.sentAt >= pending.filledAt
  )

  if (turn === undefined || pending.runId !== undefined || state.pending !== pending) {
    return
  }

  untracked(() => {
    if (turn.runId !== undefined) {
      beginMeeting(state, { pending, runId: turn.runId })
    } else if (isFinished(turn)) {
      endMeeting(state)
    }
  })
}

// The picks free now and not in the debate's cast walk in; the busy ones are named. Everyone walks
// back at the run's end.
function beginMeeting(
  state: MeetingState,
  at: { readonly pending: PendingMeeting; readonly runId: string }
): void {
  const { director } = state.deps
  const held = director.actors()
  const nowMs = performance.now()
  const free = at.pending.picks
    .filter((actor) => isFreeToMeet(held.get(actor)))
    .slice(0, MEET_AUDIENCE.spots.length)
  const busy = at.pending.picks.filter((actor) => !free.includes(actor))

  free.forEach((actor, index) => {
    director.setMeeting(actor, audienceGoal(index, nowMs))
  })
  at.pending.runId = at.runId
  at.pending.audience = free
  at.pending.offs.push(
    onWireEvent('run_finished', (event) => {
      if (event.runId === at.runId) {
        endMeeting(state)
      }
    })
  )
  picking.value = { picks: [], isHinted: false, ...busyNoteOf(busy) }
  state.deps.wake()
}

function isFreeToMeet(actor: ActorState | undefined): boolean {
  return (
    actor !== undefined &&
    actor.floor === MEET_FLOOR &&
    actor.def.room !== MEET_ROOM &&
    (actor.goal === undefined || actor.isLife)
  )
}

function audienceGoal(index: number, nowMs: number): Goal {
  const spots = MEET_AUDIENCE.spots

  return {
    kind: 'idle',
    target: spots[index % spots.length] ?? MEET_AUDIENCE.look,
    pose: AUDIENCE_POSE,
    look: MEET_AUDIENCE.look,
    since: nowMs,
  }
}

function busyNoteOf(busy: readonly ActorId[]): Pick<Picking, 'note'> {
  if (busy.length === 0) {
    return {}
  }

  const names = joinList(busy.map((actor) => tagTextOf(actor, false)))
  const key = pluralKey(busy.length, 'ui.office.meet.busyOne', 'ui.office.meet.busy')

  return { note: tr(key, { names, count: busy.length }) }
}

function endMeeting(state: MeetingState): void {
  const pending = state.pending

  if (pending === undefined) {
    return
  }

  state.pending = undefined

  for (const off of pending.offs) {
    off()
  }

  for (const actor of pending.audience) {
    state.deps.director.setMeeting(actor, undefined)
  }

  setPicking({ note: undefined })
  state.deps.wake()
}

// A field set to `undefined` is taken off; one left out keeps what it held.
function setPicking(change: {
  readonly picks?: readonly ActorId[]
  readonly isHinted?: boolean
  readonly note?: string | undefined
  readonly box?: Rect | undefined
}): void {
  const held = picking.value
  const note = 'note' in change ? change.note : held.note
  const box = 'box' in change ? change.box : held.box

  picking.value = {
    picks: change.picks ?? held.picks,
    isHinted: change.isHinted ?? held.isHinted,
    ...(note === undefined ? {} : { note }),
    ...(box === undefined ? {} : { box }),
  }
}

function boxOf(from: ScreenPoint, to: ScreenPoint): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    w: Math.abs(to.x - from.x),
    h: Math.abs(to.y - from.y),
  }
}

function isWithin(rect: Rect, point: ScreenPoint): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  )
}

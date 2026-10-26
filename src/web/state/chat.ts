import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { ChatSessionsResponse } from '@/app/server/wire/chat'
import type { ClientFrame } from '@/app/server/wire/socket'
import { stopRun } from '@/web/state/approvals'
import { onWireEvent } from '@/web/state/events'
import { type ChatServerFrame, onChatFrame, sendFrame } from '@/web/state/feed'
import { findFinishedTickers } from '@/web/state/live'
import { connection } from '@/web/state/session'

const MAX_TURNS = 200
const MAX_CHAT_STEPS = 20
const COMMAND_PREFIX = '/'

/** The channel of this app's own sessions: the only one that takes a new message or is deleted
 *  here; every other channel's session is read-only history. */
export const APP_CHANNEL = 'api'

export type ChatSession = ChatSessionsResponse['sessions'][number]

type TurnStatus = 'sending' | 'queued' | 'running' | 'done' | 'error' | 'dropped' | 'stopped'

/** A steer sent into the running answer: `text` is what was typed, or the daemon's sentence when
 *  no running turn read it. */
interface SteerNote {
  readonly state: 'sending' | 'steered' | 'dropped'
  readonly text: string
}

/** One line the operator sent and what came back. `localId` is the id sent with it, which every
 *  frame it produces echoes. `sentAt` and `doneAt` are `performance.now()` readings, so the page
 *  measures the time itself. */
export interface Turn {
  readonly localId: string
  readonly text: string
  readonly kind: 'ask' | 'slash'
  /** It runs in the command lane, beside the chat's own answer. */
  readonly isInLane?: true
  readonly status: TurnStatus
  readonly position?: number
  readonly reply: string
  readonly step?: string
  readonly steps: readonly string[]
  readonly sentAt: number
  readonly doneAt?: number
  readonly runId?: string
  readonly error?: string
  /** The session it runs in: the page's when sent, else the one the daemon named for it. */
  readonly sessionId?: string
  /** Sent while the page had no session: the session the daemon names for it becomes the page's. */
  readonly opensSession?: true
  /** The who-chip's `/agent`: its reply shows as a system line. */
  readonly isSystem?: true
  readonly steer?: SteerNote
  readonly tickers?: readonly string[]
}

interface SendOptions {
  readonly isSystem?: true
  /** Called once the daemon answered the line without an error. */
  readonly onDone?: () => void
}

const FINISHED: ReadonlySet<TurnStatus> = new Set(['done', 'error', 'dropped', 'stopped'])

const turns = signal<readonly Turn[]>([])
const isOpen = signal(false)
// Removed when the turn finishes, so it never outgrows the unfinished turns.
const doneCallbacks = new Map<string, () => void>()

export const thread: ReadonlySignal<readonly Turn[]> = turns
/** The session typing goes to; absent until the daemon names one. */
export const sessionId = signal<string | undefined>(undefined)
/** A frame arrived while the panel was closed. */
export const unread = signal(false)
export const isChatOpen: ReadonlySignal<boolean> = isOpen
/** The earlier session open read-only in the chat column; absent shows the current one. */
export const viewedSession = signal<ChatSession | undefined>(undefined)

export function isFinished(turn: Turn): boolean {
  return FINISHED.has(turn.status)
}

/** Reads the chat frames and the run events that name a turn's run. The returned stop is
 *  idempotent. */
export function startChat(): () => void {
  const offs = [
    onChatFrame(receiveFrame),
    onWireEvent('run_finished', (event) => attachTickers(event.runId, event.tickers)),
    // A dropped socket aborts the turns it ran, so none is left waiting for a frame.
    effect(() => {
      if (connection.value.status !== 'live') {
        untracked(stopUnfinished)
      }
    }),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

/** What names a session in a list or a tab: its first message, else its last answer, else its id. */
export function sessionTitleOf(session: ChatSession): string {
  return session.title ?? session.lastReply ?? session.sessionId
}

export function setChatOpen(open: boolean): void {
  isOpen.value = open

  if (open) {
    unread.value = false
  }
}

/** False when the socket is not live: nothing was sent and the caller keeps the text. */
export function sendMessage(text: string, opts: SendOptions = {}): boolean {
  const message = text.trim()
  const session = sessionId.value
  const localId = crypto.randomUUID()

  if (message === '' || !sendFrame(withSession({ type: 'chat', message, id: localId }, session))) {
    return false
  }

  if (opts.onDone !== undefined) {
    doneCallbacks.set(localId, opts.onDone)
  }

  addTurn({
    localId,
    text: message,
    kind: message.startsWith(COMMAND_PREFIX) ? 'slash' : 'ask',
    status: 'sending',
    reply: '',
    steps: [],
    sentAt: performance.now(),
    ...(session === undefined ? { opensSession: true } : { sessionId: session }),
    ...(opts.isSystem === true ? { isSystem: true } : {}),
  })

  // The who-chip's switch answers in a line; it does not pull the panel open.
  if (opts.isSystem === undefined) {
    setChatOpen(true)
  }

  return true
}

/** Adds the text to `turn`'s running answer; it reads it at its next step. A command is never a
 *  steer: it would run on its own. */
export function steer(turn: Turn, text: string): boolean {
  const message = text.trim()
  const frame = withSession({ type: 'steer', message, id: turn.localId }, resolveSession(turn))

  if (message === '' || message.startsWith(COMMAND_PREFIX) || !sendFrame(frame)) {
    return false
  }

  updateTurn(turn.localId, (held) => ({ ...held, steer: { state: 'sending', text: message } }))

  return true
}

/** Takes a waiting command out of the line; the daemon answers `dropped`. */
export function dropWaiting(turn: Turn): void {
  const session = resolveSession(turn)

  if (turn.isInLane === true && session !== undefined) {
    sendFrame({ type: 'drop', sessionId: session, id: turn.localId })
  }
}

/** True when "Dừng" can reach the turn: by its run, or by cancelling its own session. */
export function canStop(turn: Turn): boolean {
  return turn.runId !== undefined || turn.sessionId !== undefined
}

/** A command stops by its run (throws `ApiFailure`); anything else cancels what runs in its
 *  session. A cancel the socket cannot send needs none: a dropped socket already stopped it. */
export async function stopTurn(turn: Turn): Promise<void> {
  if (turn.runId !== undefined) {
    await stopRun(turn.runId)
  } else if (
    turn.sessionId === undefined ||
    !sendFrame({ type: 'cancel', sessionId: turn.sessionId })
  ) {
    return
  }

  finishTurn(turn.localId, 'stopped')
}

/** The next message opens a new session. Turns still running keep going and stay in view. */
export function startSession(): void {
  dropDoneCallbacks()
  sessionId.value = undefined
  turns.value = turns.value.flatMap((turn) => {
    if (isFinished(turn)) {
      return []
    }

    const { opensSession: _dropped, ...kept } = turn

    return [kept]
  })
}

/** Forgets every pending `onDone`: what they would apply belongs to a choice already undone. */
export function dropDoneCallbacks(): void {
  doneCallbacks.clear()
}

function resolveSession(turn: Turn): string | undefined {
  return turn.sessionId ?? sessionId.value
}

function withSession<T extends ClientFrame>(frame: T, session: string | undefined): T {
  return session === undefined ? frame : { ...frame, sessionId: session }
}

// An evicted turn takes its pending callback with it.
function addTurn(turn: Turn): void {
  const next = [...turns.value, turn]
  const evicted = next.slice(0, Math.max(0, next.length - MAX_TURNS))

  for (const old of evicted) {
    doneCallbacks.delete(old.localId)
  }

  turns.value = next.slice(-MAX_TURNS)
}

function updateTurn(localId: string, update: (turn: Turn) => Turn): void {
  turns.value = turns.value.map((turn) => (turn.localId === localId ? update(turn) : turn))
}

function finishTurn(localId: string, status: TurnStatus): void {
  updateTurn(localId, (turn) =>
    isFinished(turn) ? turn : { ...turn, status, doneAt: performance.now() }
  )
  doneCallbacks.delete(localId)
}

function stopUnfinished(): void {
  for (const turn of turns.value) {
    finishTurn(turn.localId, 'stopped')
  }
}

// Only a frame naming one of this page's lines is read: another client's frames carry no id of ours.
function frameIdOf(frame: ChatServerFrame): string | undefined {
  if (frame.kind === 'tool' || !('id' in frame)) {
    return undefined
  }

  return typeof frame.id === 'string' ? frame.id : undefined
}

function receiveFrame(frame: ChatServerFrame): void {
  const id = frameIdOf(frame)
  const turn = id === undefined ? undefined : turns.value.find((held) => held.localId === id)

  if (turn === undefined) {
    return
  }

  // A steer the turn took but never read is told after the turn has ended.
  if (isFinished(turn)) {
    if (frame.kind === 'steer_dropped') {
      updateTurn(turn.localId, () => applyFrame(turn, frame))
    }

    return
  }

  if (!isOpen.value) {
    unread.value = true
  }

  const next = applyFrame(turn, frame)

  if (next.opensSession === true && next.sessionId !== undefined) {
    adoptSessionId(next.sessionId)
  }

  updateTurn(turn.localId, () => next)
  settleCallback(next)
}

function settleCallback(turn: Turn): void {
  if (!isFinished(turn)) {
    return
  }

  const callback = doneCallbacks.get(turn.localId)

  doneCallbacks.delete(turn.localId)

  if (turn.status === 'done') {
    callback?.()
  }
}

function applyFrame(turn: Turn, frame: ChatServerFrame): Turn {
  switch (frame.kind) {
    case 'text':
      return { ...turn, reply: turn.reply + frame.delta, status: 'running' }
    case 'progress':
      return withStep(turn, frame.text)
    case 'queued':
      return toQueued(turn, frame.position, frame.sessionId)
    case 'started':
      return toStarted(turn, frame.runId, frame.sessionId)
    case 'dropped':
      // A command told to stop after it began ends as dropped too.
      return toFinished(turn, turn.status === 'running' ? 'stopped' : 'dropped')
    case 'done':
      return toDone(turn, frame.runId, frame.sessionId)
    case 'error':
      return { ...toFinished(turn, 'error'), error: frame.message }
    case 'steered':
      return { ...turn, steer: { state: 'steered', text: turn.steer?.text ?? '' } }
    case 'steer_dropped':
      return { ...turn, steer: { state: 'dropped', text: frame.text } }
    default:
      return turn.status === 'running' ? turn : { ...turn, status: 'running' }
  }
}

// A position is a place in the command lane; without one the line waits behind the chat's answer.
function toQueued(turn: Turn, position: number | undefined, session: string | undefined): Turn {
  return {
    ...turn,
    status: 'queued',
    ...(position === undefined ? {} : { position, isInLane: true }),
    ...(session === undefined ? {} : { sessionId: session }),
  }
}

// A start with a run is a command in the lane; an agent turn starts with its session.
function toStarted(turn: Turn, runId: string | undefined, session: string | undefined): Turn {
  return {
    ...turn,
    status: 'running',
    ...(runId === undefined ? {} : { runId, isInLane: true }),
    ...(session === undefined ? {} : { sessionId: session }),
  }
}

function withStep(turn: Turn, step: string): Turn {
  const steps = turn.steps.at(-1) === step ? turn.steps : [...turn.steps, step]

  return { ...turn, status: 'running', step, steps: steps.slice(-MAX_CHAT_STEPS) }
}

function toFinished(turn: Turn, status: TurnStatus): Turn {
  return { ...turn, status, doneAt: performance.now() }
}

function toDone(turn: Turn, frameRunId: string | undefined, session: string | undefined): Turn {
  const runId = frameRunId ?? turn.runId
  // The live store notes a finished run's tickers before the hub tells anyone of the event.
  const tickers = runId === undefined ? [] : findFinishedTickers(runId)

  return {
    ...toFinished(turn, 'done'),
    ...(runId === undefined ? {} : { runId }),
    ...(tickers.length === 0 ? {} : { tickers }),
    ...(turn.sessionId === undefined && session !== undefined ? { sessionId: session } : {}),
  }
}

// Only a page with no session takes one: a turn from an earlier session never pulls it back.
function adoptSessionId(next: string): void {
  if (sessionId.value === undefined) {
    sessionId.value = next
  }
}

// A run that ends after its `done` frame hands its tickers to the turn it answered.
function attachTickers(runId: string | undefined, tickers: readonly string[] | undefined): void {
  if (runId === undefined || tickers === undefined || tickers.length === 0) {
    return
  }

  const turn = turns.value.find((held) => held.runId === runId)

  if (turn !== undefined) {
    updateTurn(turn.localId, (held) => ({ ...held, tickers }))
  }
}

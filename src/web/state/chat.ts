import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { ClientFrame } from '@/app/server/wire/socket'
import { stopRun } from '@/web/state/approvals'
import { onWireEvent } from '@/web/state/events'
import { type ChatServerFrame, onChatFrame, sendFrame } from '@/web/state/feed'
import { connection } from '@/web/state/session'

const MAX_TURNS = 200
const MAX_CHAT_STEPS = 20
// Tickers of the runs that ended lately, kept until the chat's `done` names its run.
const MAX_FINISHED_RUNS = 20
const COMMAND_PREFIX = '/'

type TurnStatus = 'sending' | 'queued' | 'running' | 'done' | 'error' | 'dropped' | 'stopped'

/** A steer sent into the running answer: `text` is what was typed, or the daemon's sentence when
 *  no running turn read it. */
interface SteerNote {
  readonly state: 'sending' | 'steered' | 'dropped'
  readonly text: string
}

/** One line the operator sent and what came back. `sentAt` and `doneAt` are `performance.now()`
 *  readings, so the page measures the time itself. */
export interface Turn {
  readonly localId: string
  readonly text: string
  readonly kind: 'ask' | 'slash'
  /** The command lane's id, once its first frame named it. */
  readonly laneId?: string
  readonly status: TurnStatus
  readonly position?: number
  readonly reply: string
  readonly step?: string
  readonly steps: readonly string[]
  readonly sentAt: number
  readonly doneAt?: number
  readonly runId?: string
  readonly error?: string
  /** The session it was sent in; absent when the page had none yet. */
  readonly sessionId?: string
  /** The who-chip's `/agent`: its reply shows as a system line. */
  readonly isSystem?: true
  readonly steer?: SteerNote
  readonly tickers?: readonly string[]
}

const FINISHED: ReadonlySet<TurnStatus> = new Set(['done', 'error', 'dropped', 'stopped'])

const turns = signal<readonly Turn[]>([])
const finishedTickers = new Map<string, readonly string[]>()
let turnSeq = 0

export const thread: ReadonlySignal<readonly Turn[]> = turns
/** The session typing goes to; absent until the daemon names one. */
export const sessionId = signal<string | undefined>(undefined)
/** A frame arrived while the panel was closed. */
export const unread = signal(false)
const isOpen = signal(false)

export const isChatOpen: ReadonlySignal<boolean> = isOpen

export function isFinished(turn: Turn): boolean {
  return FINISHED.has(turn.status)
}

/** Reads the chat frames and the run events that name a turn's run. The returned stop is
 *  idempotent. */
export function startChat(): () => void {
  const offs = [
    onChatFrame(receiveFrame),
    onWireEvent('run_started', (event) => adoptSession(event.runId, event.run?.sessionId)),
    onWireEvent('run_finished', (event) => keepTickers(event.runId, event.tickers)),
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

export function setChatOpen(open: boolean): void {
  isOpen.value = open

  if (open) {
    unread.value = false
  }
}

/** False when the socket is not live: nothing was sent and the caller keeps the text. */
export function sendMessage(text: string, opts: { readonly isSystem?: true } = {}): boolean {
  const message = text.trim()
  const session = sessionId.value

  if (message === '' || !sendFrame(withSession({ type: 'chat', message }, session))) {
    return false
  }

  turnSeq++
  addTurn({
    localId: String(turnSeq),
    text: message,
    kind: message.startsWith(COMMAND_PREFIX) ? 'slash' : 'ask',
    status: 'sending',
    reply: '',
    steps: [],
    sentAt: performance.now(),
    ...(session === undefined ? {} : { sessionId: session }),
    ...(opts.isSystem === true ? { isSystem: true } : {}),
  })

  // The who-chip's switch answers in a line; it does not pull the panel open.
  if (opts.isSystem === undefined) {
    setChatOpen(true)
  }

  return true
}

/** Adds the text to the answer running now; it reads it at its next step. */
export function steer(text: string): boolean {
  const message = text.trim()
  const head = findHead()

  if (message === '' || head === undefined) {
    return false
  }

  if (!sendFrame(withSession({ type: 'steer', message }, head.sessionId ?? sessionId.value))) {
    return false
  }

  updateTurn(head.localId, (turn) => ({ ...turn, steer: { state: 'sending', text: message } }))

  return true
}

/** Takes a waiting command out of the line; the daemon answers `dropped`. */
export function dropWaiting(turn: Turn): void {
  const session = turn.sessionId ?? sessionId.value

  if (turn.laneId !== undefined && session !== undefined) {
    sendFrame({ type: 'drop', sessionId: session, id: turn.laneId })
  }
}

/** True when "Dừng" can reach the turn: by its run, or by cancelling its session. */
export function canStop(turn: Turn): boolean {
  return turn.runId !== undefined || (turn.kind === 'ask' && resolveSession(turn) !== undefined)
}

/** A command stops by its run (throws `ApiFailure`); an agent turn cancels what runs in this chat.
 *  A cancel the socket cannot send needs none: a dropped socket already stopped the turn. */
export async function stopTurn(turn: Turn): Promise<void> {
  if (turn.runId !== undefined) {
    await stopRun(turn.runId)
  } else {
    const session = resolveSession(turn)

    if (session === undefined || !sendFrame({ type: 'cancel', sessionId: session })) {
      return
    }
  }

  finishTurn(turn.localId, 'stopped')
}

/** The next message opens a new session. Turns still running keep going and stay in view. */
export function startSession(): void {
  sessionId.value = undefined
  turns.value = turns.value.filter((turn) => !isFinished(turn))
}

function resolveSession(turn: Turn): string | undefined {
  return turn.sessionId ?? sessionId.value
}

function withSession<T extends ClientFrame>(frame: T, session: string | undefined): T {
  return session === undefined ? frame : { ...frame, sessionId: session }
}

function addTurn(turn: Turn): void {
  turns.value = [...turns.value, turn].slice(-MAX_TURNS)
}

function updateTurn(localId: string, update: (turn: Turn) => Turn): void {
  turns.value = turns.value.map((turn) => (turn.localId === localId ? update(turn) : turn))
}

function finishTurn(localId: string, status: TurnStatus): void {
  updateTurn(localId, (turn) =>
    isFinished(turn) ? turn : { ...turn, status, doneAt: performance.now() }
  )
}

function stopUnfinished(): void {
  for (const turn of turns.value) {
    finishTurn(turn.localId, 'stopped')
  }
}

// The session queue is FIFO, so a frame without a lane id belongs to the oldest unfinished turn
// outside the lane.
function findHead(): Turn | undefined {
  return turns.value.find((turn) => turn.laneId === undefined && !isFinished(turn))
}

// A plain `queued` speaks for the message just held back, not for the answer that holds it.
function resolveSessionTurn(frame: ChatServerFrame): Turn | undefined {
  if (frame.kind !== 'queued') {
    return findHead()
  }

  return turns.value.find((turn) => turn.laneId === undefined && turn.status === 'sending')
}

// A lane id the page has not seen is the oldest command still waiting for its first frame.
function resolveLaneTurn(laneId: string): Turn | undefined {
  const bound = turns.value.find((turn) => turn.laneId === laneId)

  if (bound !== undefined) {
    return bound
  }

  const waiting = turns.value.find(
    (turn) =>
      turn.status === 'sending' &&
      turn.kind === 'slash' &&
      turn.laneId === undefined &&
      turn.isSystem === undefined
  )

  if (waiting === undefined) {
    return undefined
  }

  updateTurn(waiting.localId, (turn) => ({ ...turn, laneId }))

  return { ...waiting, laneId }
}

// A tool frame's `id` names its tool call, never a lane.
function laneIdOf(frame: ChatServerFrame): string | undefined {
  if (frame.kind === 'tool' || !('id' in frame)) {
    return undefined
  }

  return typeof frame.id === 'string' ? frame.id : undefined
}

function receiveFrame(frame: ChatServerFrame): void {
  if (!isChatOpen.value) {
    unread.value = true
  }

  if (frame.kind === 'steered' || frame.kind === 'steer_dropped') {
    noteSteer(frame.kind === 'steered' ? undefined : frame.text)
    return
  }

  const laneId = laneIdOf(frame)
  const turn = laneId === undefined ? resolveSessionTurn(frame) : resolveLaneTurn(laneId)

  if (turn === undefined || isFinished(turn)) {
    return
  }

  if (frame.kind === 'done' && frame.sessionId !== undefined && turn.sessionId === undefined) {
    adoptSessionId(frame.sessionId)
  }

  updateTurn(turn.localId, (held) => applyFrame(held, frame))
}

function applyFrame(turn: Turn, frame: ChatServerFrame): Turn {
  switch (frame.kind) {
    case 'text':
      return { ...turn, reply: turn.reply + frame.delta, status: 'running' }
    case 'progress':
      return withStep(turn, frame.text)
    case 'tool':
      return 'name' in frame
        ? withStep(turn, frame.detail === undefined ? frame.name : `${frame.name} ${frame.detail}`)
        : turn
    case 'queued':
      return { ...turn, status: 'queued', ...positionOf(frame.position) }
    case 'started':
      return {
        ...turn,
        status: 'running',
        ...(frame.runId === undefined ? {} : { runId: frame.runId }),
      }
    case 'dropped':
      // A command told to stop after it began ends as dropped too.
      return toFinished(turn, turn.status === 'running' ? 'stopped' : 'dropped')
    case 'done':
      return toDone(turn, frame.runId)
    case 'error':
      return { ...toFinished(turn, 'error'), error: frame.message }
    default:
      return turn.status === 'running' ? turn : { ...turn, status: 'running' }
  }
}

function positionOf(position: number | undefined): Pick<Turn, 'position'> {
  return position === undefined ? {} : { position }
}

function withStep(turn: Turn, step: string): Turn {
  const steps = turn.steps.at(-1) === step ? turn.steps : [...turn.steps, step]

  return { ...turn, status: 'running', step, steps: steps.slice(-MAX_CHAT_STEPS) }
}

function toFinished(turn: Turn, status: TurnStatus): Turn {
  return { ...turn, status, doneAt: performance.now() }
}

function toDone(turn: Turn, frameRunId: string | undefined): Turn {
  const runId = frameRunId ?? turn.runId
  const tickers = runId === undefined ? undefined : finishedTickers.get(runId)

  return {
    ...toFinished(turn, 'done'),
    ...(runId === undefined ? {} : { runId }),
    ...(tickers === undefined ? {} : { tickers }),
  }
}

// `undefined` is the daemon's "steered"; text is its sentence asking to send it again.
function noteSteer(droppedText: string | undefined): void {
  const target =
    turns.value.find((turn) => turn.steer?.state === 'sending') ?? findHead() ?? turns.value.at(-1)

  if (target === undefined) {
    return
  }

  const steerNote: SteerNote =
    droppedText === undefined
      ? { state: 'steered', text: target.steer?.text ?? '' }
      : { state: 'dropped', text: droppedText }

  updateTurn(target.localId, (turn) => ({ ...turn, steer: steerNote }))
}

// A command's start names its run's session before its answer does.
function adoptSession(runId: string | undefined, runSessionId: string | undefined): void {
  const turn = turns.value.find((held) => held.runId !== undefined && held.runId === runId)

  if (turn?.sessionId === undefined && runSessionId !== undefined && turn !== undefined) {
    adoptSessionId(runSessionId)
  }
}

// Only a page with no session takes one: a turn from an earlier session never pulls it back.
function adoptSessionId(next: string): void {
  if (sessionId.value === undefined) {
    sessionId.value = next
  }
}

function keepTickers(runId: string | undefined, tickers: readonly string[] | undefined): void {
  if (runId === undefined || tickers === undefined || tickers.length === 0) {
    return
  }

  const turn = turns.value.find((held) => held.runId === runId)

  if (turn !== undefined) {
    updateTurn(turn.localId, (held) => ({ ...held, tickers }))
  }

  finishedTickers.set(runId, tickers)

  for (const oldest of finishedTickers.keys()) {
    if (finishedTickers.size <= MAX_FINISHED_RUNS) {
      break
    }

    finishedTickers.delete(oldest)
  }
}

import { effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import type { ChatSessionsResponse } from '@/app/server/wire/chat'
import type { WireEvent } from '@/app/server/wire/events'
import type { ClientFrame } from '@/app/server/wire/socket'
import { stopRun } from '@/web/state/approvals'
import { applyFrame } from '@/web/state/chat-turn'
import { isAnalysisOnly } from '@/web/state/edition'
import { onWireEvent } from '@/web/state/events'
import { type ChatServerFrame, onChatFrame, sendFrame } from '@/web/state/feed'
import { connection } from '@/web/state/session'

const MAX_TURNS = 200
const WORD_BREAK = /\s+/
// One line per preference the hook keeps, of which there are five.
const MAX_TURN_PREFERENCES = 5
/** What starts a command rather than a question. */
export const COMMAND_PREFIX = '/'
/** The role of a message the operator wrote. */
export const USER_ROLE = 'user'

/** The channel of this app's own sessions: the only one that takes a new message or is deleted
 *  here; every other channel's session is read-only history. */
export const APP_CHANNEL = 'api'

export type ChatSession = ChatSessionsResponse['sessions'][number]

/** A preference the answer's chat stored or dropped, as the daemon told it. */
export type SavedPreference = NonNullable<WireEvent['preference']>

/** `cut` is a turn the page lost with its connection; `stopped` one the operator or a run stopped. */
export type TurnStatus =
  | 'sending'
  | 'queued'
  | 'running'
  | 'done'
  | 'error'
  | 'dropped'
  | 'stopped'
  | 'cut'

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
  /** `Date.now()` when the connection dropped under a `cut` turn. */
  readonly cutAt?: number
  readonly runId?: string
  readonly error?: string
  /** Why the run halted, when it ended with no reply to show. */
  readonly haltCode?: string
  /** The session it runs in: the page's when sent, else the one the daemon named for it. */
  readonly sessionId?: string
  /** Sent while the page had no session: the session the daemon names for it becomes the page's. */
  readonly opensSession?: true
  /** The who-chip's `/agent`: its reply shows as a system line. */
  readonly isSystem?: true
  readonly steer?: SteerNote
  /** An agent turn answers it: a plain message always, a command once it handed its turn to one. */
  readonly byAgent?: true
  readonly tickers?: readonly string[]
  readonly preferences?: readonly SavedPreference[]
}

interface SendOptions {
  readonly isSystem?: true
  /** Called once the daemon answered the line without an error. */
  readonly onDone?: () => void
}

const FINISHED: ReadonlySet<TurnStatus> = new Set(['done', 'error', 'dropped', 'stopped', 'cut'])

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

/** The words of a line, the command first and lower-cased: the dispatcher reads `/Suggest` as
 *  `/suggest`, so the page compares a typed name only through this. */
export function commandWordsOf(text: string): readonly string[] {
  const [command = '', ...args] = text.trim().split(WORD_BREAK)

  return [command.toLowerCase(), ...args]
}

/** The first word of a line: the command it names, slash included. */
export function commandWordOf(text: string): string {
  return commandWordsOf(text)[0] ?? ''
}

/** Reads the chat frames and the run events that name a turn's run. The returned stop is
 *  idempotent. */
export function startChat(): () => void {
  const offs = [
    onChatFrame(receiveFrame),
    onWireEvent('run_finished', (event) => attachTickers(event.runId, event.tickers)),
    onWireEvent('preference_saved', (event) => attachPreference(event.preference)),
    // A dropped socket aborts the turns it ran, so none is left waiting for a frame.
    effect(() => {
      if (connection.value.status !== 'live') {
        untracked(cutUnfinished)
      }
    }),
  ]

  return () => {
    for (const off of offs) {
      off()
    }

    // No frame reaches a stopped chat. The effect above cannot cut here: a teardown runs batched,
    // so the status it sets lands after the effect is gone.
    cutUnfinished()
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

  const isCommand = message.startsWith(COMMAND_PREFIX)

  addTurn({
    localId,
    text: message,
    kind: isCommand ? 'slash' : 'ask',
    ...(isCommand ? {} : { byAgent: true }),
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

/** A line that can be added to a running answer: not empty, and never a command, which would run
 *  on its own. */
export function isSteerable(text: string): boolean {
  const message = text.trim()

  return message !== '' && !message.startsWith(COMMAND_PREFIX)
}

/** Adds the text to `turn`'s running answer; it reads it at its next step. False when the line
 *  is not steerable or the socket is not live. */
export function steer(turn: Turn, text: string): boolean {
  const message = text.trim()
  const frame = withSession({ type: 'steer', message, id: turn.localId }, resolveSession(turn))

  if (!(isSteerable(message) && sendFrame(frame))) {
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
  return turn.runId !== undefined || stopSessionOf(turn) !== undefined
}

/** A command stops by its run (throws `ApiFailure`); anything else cancels what runs in its
 *  session. A cancel the socket cannot send needs none: a dropped socket already stopped it. */
export async function stopTurn(turn: Turn): Promise<void> {
  const session = stopSessionOf(turn)

  if (turn.runId !== undefined) {
    await stopRun(turn.runId)
  } else if (session === undefined || !sendFrame({ type: 'cancel', sessionId: session })) {
    return
  }

  endAsStopped(turn.localId)
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

// The web edition's frames can name no session, which leaves the turn with the page's.
function stopSessionOf(turn: Turn): string | undefined {
  return isAnalysisOnly.value ? resolveSession(turn) : turn.sessionId
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

// A stop the run took ends its turn as stopped, also when the run's `done` came before the reply.
function endAsStopped(localId: string): void {
  updateTurn(localId, (turn) =>
    isFinished(turn) && turn.status !== 'done'
      ? turn
      : { ...turn, status: 'stopped', doneAt: turn.doneAt ?? performance.now() }
  )
  doneCallbacks.delete(localId)
}

// The turns that were waiting for a frame ended with the connection, at this instant.
function cutUnfinished(): void {
  if (turns.value.every(isFinished)) {
    return
  }

  const cutAt = Date.now()
  const doneAt = performance.now()

  turns.value = turns.value.map((turn) =>
    isFinished(turn) ? turn : { ...turn, status: 'cut', cutAt, doneAt }
  )
  // Every pending callback belongs to an unfinished turn, which is now over.
  doneCallbacks.clear()
}

/** The page's own id a frame names; another client's frames carry no id of ours. */
export function frameIdOf(frame: ChatServerFrame): string | undefined {
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

/** Only a page with no session takes one: a line from an earlier session never pulls it back. */
export function adoptSessionId(next: string): void {
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

// Told under the latest question asked in that chat; a chat this page shows no question of is left
// to Bộ nhớ.
function attachPreference(preference: SavedPreference | undefined): void {
  if (preference === undefined) {
    return
  }

  const turn = turns.value.findLast(
    (held) => held.kind === 'ask' && resolveSession(held) === preference.sessionId
  )

  if (turn !== undefined) {
    updateTurn(turn.localId, (held) => ({
      ...held,
      preferences: [...(held.preferences ?? []), preference].slice(-MAX_TURN_PREFERENCES),
    }))
  }
}

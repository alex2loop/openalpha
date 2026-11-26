import type { Turn, TurnStatus } from '@/web/state/chat'
import type { ChatServerFrame } from '@/web/state/feed'
import { findFinishedTickers } from '@/web/state/live'

const MAX_CHAT_STEPS = 20

/** The turn as one more chat frame leaves it; the chat state decides when to apply it. */
export function applyFrame(turn: Turn, frame: ChatServerFrame): Turn {
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
      return toDone(turn, frame)
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
    ...(runId === undefined ? { byAgent: true } : { runId, isInLane: true }),
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

function toDone(turn: Turn, frame: Extract<ChatServerFrame, { readonly kind: 'done' }>): Turn {
  const { sessionId: session, haltCode } = frame
  const runId = frame.runId ?? turn.runId
  // The live store notes a finished run's tickers before the hub tells anyone of the event.
  const tickers = runId === undefined ? [] : findFinishedTickers(runId)

  return {
    ...toFinished(turn, 'done'),
    ...(runId === undefined ? {} : { runId }),
    ...(tickers.length === 0 ? {} : { tickers }),
    ...(haltCode === undefined || turn.reply.trim() !== '' ? {} : { haltCode }),
    ...(turn.sessionId === undefined && session !== undefined ? { sessionId: session } : {}),
  }
}

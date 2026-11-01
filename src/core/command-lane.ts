import type { ChannelId } from '@/core/channels'
import type { CommandLane, CommandLaneEntry, SessionRouteRegistration } from '@/core/types/session'
import { RunHalted } from '@/core/errors'

const MAX_RUNNING_PER_CHAT = 3
const MAX_WAITING_PER_CHAT = 10

interface Waiter {
  readonly id: string
  readonly registration: SessionRouteRegistration
  /** Runs the task and settles the caller's promise; never rejects itself. */
  readonly run: () => Promise<void>
  readonly reject: (err: RunHalted) => void
}

interface LaneState {
  readonly key: string
  running: number
  readonly waiting: Waiter[]
}

type Lanes = Map<string, LaneState>

/** One lane per chat, shared by every surface that reaches it. */
export function toCommandLaneKey(channel: ChannelId, chatId: string): string {
  return `${channel}:${chatId}`
}

// Runs a chat's self-contained commands side by side instead of behind the session's turn: up to
// MAX_RUNNING_PER_CHAT at once, the rest waiting in order, up to MAX_WAITING_PER_CHAT. The lane owns
// the route registration it is handed and releases it when the task starts or never will.
export function createCommandLane(): CommandLane {
  const lanes: Lanes = new Map()
  let paused = false

  return {
    enqueue<T>(input: CommandLaneEntry<T>): Promise<T> {
      if (paused) {
        input.registration.release()

        return Promise.reject(new RunHalted('queue_full', 'shutting down'))
      }

      return admit(lanes, input)
    },

    cancel(key: string): void {
      cancelWaiting(lanes, key, () => true)
    },

    drop(key: string, id: string): boolean {
      return cancelWaiting(lanes, key, (waiter) => waiter.id === id)
    },

    pause(): void {
      paused = true

      for (const key of [...lanes.keys()]) {
        cancelWaiting(lanes, key, () => true)
      }
    },
  }
}

function admit<T>(lanes: Lanes, input: CommandLaneEntry<T>): Promise<T> {
  const { key, id, registration, task, onWaiting } = input
  const existing = lanes.get(key)

  if (existing !== undefined && existing.waiting.length >= MAX_WAITING_PER_CHAT) {
    registration.release()

    return Promise.reject(
      new RunHalted('queue_full', `command lane full (${MAX_WAITING_PER_CHAT} waiting)`)
    )
  }

  const state: LaneState = existing ?? { key, running: 0, waiting: [] }

  lanes.set(key, state)

  return new Promise<T>((resolve, reject) => {
    const waiter: Waiter = {
      id,
      registration,
      reject,
      run: async () => {
        try {
          resolve(await task())
        } catch (err: unknown) {
          reject(err)
        }
      },
    }

    if (state.running < MAX_RUNNING_PER_CHAT && state.waiting.length === 0) {
      launch(lanes, state, waiter)
      prune(lanes, state)

      return
    }

    state.waiting.push(waiter)
    notifyWaiting(onWaiting, state.waiting.length)
  })
}

// A registration gone stale (the chat moved to a new session) must not start work on the old one.
function launch(lanes: Lanes, state: LaneState, waiter: Waiter): void {
  const stale = !waiter.registration.isCurrent()

  waiter.registration.release()

  if (stale) {
    waiter.reject(new RunHalted('abort', 'stale command route rejected'))

    return
  }

  state.running++
  waiter.run().then(() => {
    state.running--
    pump(lanes, state)
  })
}

function pump(lanes: Lanes, state: LaneState): void {
  while (state.running < MAX_RUNNING_PER_CHAT) {
    const next = state.waiting.shift()

    if (next === undefined) {
      break
    }

    launch(lanes, state, next)
  }

  prune(lanes, state)
}

/** Only a lane with nothing running and nothing waiting is removed, so a key never outlives its
 *  work. */
function prune(lanes: Lanes, state: LaneState): void {
  if (state.running === 0 && state.waiting.length === 0 && lanes.get(state.key) === state) {
    lanes.delete(state.key)
  }
}

/** Rejects the waiting tasks `matches` picks, in line order; a running task is left alone. */
function cancelWaiting(lanes: Lanes, key: string, matches: (waiter: Waiter) => boolean): boolean {
  const state = lanes.get(key)

  if (state === undefined) {
    return false
  }

  const removed = state.waiting.filter(matches)

  for (const waiter of removed) {
    state.waiting.splice(state.waiting.indexOf(waiter), 1)
    waiter.registration.release()
    waiter.reject(new RunHalted('abort', 'queued command cancelled'))
  }

  prune(lanes, state)

  return removed.length > 0
}

// Best effort: a throw inside the Promise executor would reject the caller's promise while the task
// stays in line and still runs.
function notifyWaiting(
  onWaiting: ((position: number) => void) | undefined,
  position: number
): void {
  try {
    onWaiting?.(position)
  } catch {
    // The queued line is a courtesy; the task still waits its turn.
  }
}

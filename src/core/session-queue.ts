import type { SessionId } from '@/core/ids'
import type {
  ChatRouteKey,
  SessionQueue,
  SessionRouteKey,
  SessionRouteLease,
  SessionRouteRegistration,
} from '@/core/types/session'
import { RunHalted } from '@/core/errors'

const MAX_QUEUE_DEPTH = 10

interface RouteEntry {
  generation: number
  leases: number
  registrations: number
  switching: Promise<void> | null
  finishSwitch: (() => void) | null
}

interface RouteFence {
  acquire(key: SessionRouteKey): Promise<SessionRouteLease>
  coordinate<T>(key: SessionRouteKey, task: (invalidate: () => void) => Promise<T>): Promise<T>
  coordinateChat<T>(key: ChatRouteKey, task: (invalidate: () => void) => Promise<T>): Promise<T>
}

interface SessionTracking {
  readonly tails: Map<SessionId, Promise<unknown>>
  readonly depths: Map<SessionId, number>
  readonly generations: Map<SessionId, number>
}

interface RouteRegistrationOptions {
  readonly entries: Map<string, RouteEntry>
  readonly key: string
  readonly entry: RouteEntry
  readonly generation: number
}

// Serializes work per session: a second message for the same session waits for the first to finish,
// so two runs never mutate one conversation concurrently. Beyond MAX_QUEUE_DEPTH pending tasks the
// session sheds load rather than growing an unbounded backlog.
export function createSessionQueue(): SessionQueue {
  const tails = new Map<SessionId, Promise<unknown>>()
  const depths = new Map<SessionId, number>()
  const generations = new Map<SessionId, number>()
  const routes = createRouteFence()
  let paused = false

  return {
    depth(sessionId: SessionId): number {
      return depths.get(sessionId) ?? 0
    },

    cancelSession(sessionId: SessionId): void {
      if (tails.has(sessionId)) {
        generations.set(sessionId, (generations.get(sessionId) ?? 0) + 1)
      }
    },

    acquireRoute: (key) => routes.acquire(key),

    coordinateRoute: (key, task) => routes.coordinate(key, task),

    coordinateChat: (key, task) => routes.coordinateChat(key, task),

    pause(): void {
      paused = true
    },

    enqueue<T>(
      sessionId: SessionId,
      task: () => Promise<T>,
      route?: SessionRouteRegistration
    ): Promise<T> {
      try {
        if (paused) {
          return Promise.reject(new RunHalted('queue_full', 'shutting down'))
        }

        if (route !== undefined && !route.isCurrent()) {
          return Promise.reject(new RunHalted('abort', 'stale session route rejected'))
        }

        const depth = depths.get(sessionId) ?? 0

        if (depth >= MAX_QUEUE_DEPTH) {
          return Promise.reject(
            new RunHalted('queue_full', `session queue full (${MAX_QUEUE_DEPTH} pending)`)
          )
        }

        depths.set(sessionId, depth + 1)

        const generation = generations.get(sessionId) ?? 0
        const previous = tails.get(sessionId) ?? Promise.resolve()
        const next = previous.then(() => {
          if ((generations.get(sessionId) ?? 0) !== generation) {
            return Promise.reject(new RunHalted('abort', 'queued session work cancelled'))
          }

          return task()
        })
        // The tail swallows rejections so one failed task cannot poison the whole session chain, and
        // the tail is replaced rather than appended to, so the chain never grows without bound.
        const tracked: Promise<unknown> = next
          .catch(() => undefined)
          .finally(() => settleSession({ tails, depths, generations }, sessionId, tracked))

        tails.set(sessionId, tracked)

        return next
      } finally {
        route?.release()
      }
    },
  }
}

function settleSession(
  sessions: SessionTracking,
  sessionId: SessionId,
  tracked: Promise<unknown>
): void {
  const { tails, depths, generations } = sessions
  const remaining = (depths.get(sessionId) ?? 1) - 1

  if (remaining <= 0) {
    depths.delete(sessionId)
    generations.delete(sessionId)
  } else {
    depths.set(sessionId, remaining)
  }

  if (tails.get(sessionId) === tracked) {
    tails.delete(sessionId)
  }
}

function createRouteFence(): RouteFence {
  const entries = new Map<string, RouteEntry>()

  return {
    async acquire(key): Promise<SessionRouteLease> {
      return acquireRoute(entries, chatKeyOf(key), routeKeyOf(key))
    },

    async coordinate<T>(
      key: SessionRouteKey,
      task: (invalidate: () => void) => Promise<T>
    ): Promise<T> {
      return coordinateRoute(entries, routeKeyOf(key), task)
    },

    async coordinateChat<T>(
      key: ChatRouteKey,
      task: (invalidate: () => void) => Promise<T>
    ): Promise<T> {
      return coordinateChatRoute(entries, key, task)
    },
  }
}

// Waits on both fences: a chat-wide switch marks `switching` on the chat entry only, so checking
// just the user entry would admit a message mid-switch under the old binding.
async function acquireRoute(
  entries: Map<string, RouteEntry>,
  chatKey: string,
  key: string
): Promise<SessionRouteLease> {
  while (true) {
    const chatSwitch = entries.get(chatKey)?.switching

    if (chatSwitch !== null && chatSwitch !== undefined) {
      await chatSwitch
      continue
    }

    const entry = getRouteEntry(entries, key)

    if (entry.switching !== null) {
      await entry.switching
      continue
    }

    entry.leases++
    return createRouteLease(entries, key, entry)
  }
}

async function coordinateRoute<T>(
  entries: Map<string, RouteEntry>,
  key: string,
  task: (invalidate: () => void) => Promise<T>
): Promise<T> {
  return withRouteSwitch(entries, key, (entry) =>
    task(
      invalidateOnce(() => {
        entry.generation++
      })
    )
  )
}

async function coordinateChatRoute<T>(
  entries: Map<string, RouteEntry>,
  key: ChatRouteKey,
  task: (invalidate: () => void) => Promise<T>
): Promise<T> {
  const prefix = `${chatKeyOf(key)}:`
  return withRouteSwitch(entries, chatKeyOf(key), () =>
    task(
      invalidateOnce(() => {
        for (const [entryKey, entry] of entries) {
          if (entryKey.startsWith(prefix)) {
            entry.generation++
          }
        }
      })
    )
  )
}

async function withRouteSwitch<T>(
  entries: Map<string, RouteEntry>,
  key: string,
  run: (entry: RouteEntry) => Promise<T>
): Promise<T> {
  while (true) {
    const entry = getRouteEntry(entries, key)

    if (entry.switching !== null) {
      await entry.switching
      continue
    }

    beginSwitch(entry)

    try {
      return await run(entry)
    } finally {
      finishSwitch(entries, key, entry)
    }
  }
}

function invalidateOnce(bump: () => void): () => void {
  let invalidated = false

  return () => {
    if (!invalidated) {
      invalidated = true
      bump()
    }
  }
}

function createRouteLease(
  entries: Map<string, RouteEntry>,
  key: string,
  entry: RouteEntry
): SessionRouteLease {
  const generation = entry.generation
  let released = false
  let registered = false

  return {
    register(): SessionRouteRegistration {
      if (released || registered) {
        return staleRegistration()
      }

      registered = true
      entry.registrations++
      return createRouteRegistration({ entries, key, entry, generation })
    },
    release(): void {
      if (released) {
        return
      }

      released = true
      entry.leases--
      cleanupRouteEntry(entries, key, entry)
    },
  }
}

function createRouteRegistration(options: RouteRegistrationOptions): SessionRouteRegistration {
  const { entries, key, entry, generation } = options
  let released = false

  return {
    isCurrent: () => !released && entry.generation === generation,
    release(): void {
      if (released) {
        return
      }

      released = true
      entry.registrations--
      cleanupRouteEntry(entries, key, entry)
    },
  }
}

function staleRegistration(): SessionRouteRegistration {
  return { isCurrent: () => false, release: () => undefined }
}

function getRouteEntry(entries: Map<string, RouteEntry>, key: string): RouteEntry {
  const existing = entries.get(key)

  if (existing !== undefined) {
    return existing
  }

  const created: RouteEntry = {
    generation: 0,
    leases: 0,
    registrations: 0,
    switching: null,
    finishSwitch: null,
  }
  entries.set(key, created)
  return created
}

function beginSwitch(entry: RouteEntry): void {
  entry.switching = new Promise<void>((resolve) => {
    entry.finishSwitch = resolve
  })
}

function finishSwitch(entries: Map<string, RouteEntry>, key: string, entry: RouteEntry): void {
  const finish = entry.finishSwitch

  entry.finishSwitch = null
  entry.switching = null
  finish?.()
  cleanupRouteEntry(entries, key, entry)
}

function cleanupRouteEntry(entries: Map<string, RouteEntry>, key: string, entry: RouteEntry): void {
  if (entry.leases === 0 && entry.registrations === 0 && entry.switching === null) {
    entries.delete(key)
  }
}

// User keys extend the chat key, so a chat-global mutation can find every user entry of its chat
// by prefix. JSON's closing bracket keeps distinct chat ids from prefix-colliding.
function chatKeyOf(key: ChatRouteKey): string {
  return JSON.stringify([key.channel, key.chatId])
}

function routeKeyOf(key: SessionRouteKey): string {
  return `${chatKeyOf(key)}:${key.userId}`
}

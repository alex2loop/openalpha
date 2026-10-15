import type { ChannelId } from '@/core/channels'
import type { RunId, SessionId } from '@/core/ids'
import type { RunDeadline } from '@/core/tool'
import type { RunHandle, RunIdentity, RunLifecycle, RunRegistry } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'

// A private symbol cannot collide with a caller-supplied abort reason, so `signal.reason ===
// TIMEOUT_ABORT` is an unambiguous "the duration limit fired" test.
export const TIMEOUT_ABORT: unique symbol = Symbol('run duration limit exceeded')

// An unbounded run has no clock to stop.
export const NO_DEADLINE: RunDeadline = { pause: noop, resume: noop }

const ACTIVE_LIFECYCLES: ReadonlySet<RunLifecycle> = new Set(['running'])

interface ComposedAbort {
  readonly controller: AbortController
  readonly deadline: RunDeadline
  readonly dispose: () => void
}

// run.ts needs to close out a handle; callers of the bound `runRegistry` service do not.
export interface RunTracker extends RunRegistry {
  markDone(runId: RunId, lifecycle: RunLifecycle): void
}

interface RunEntry {
  readonly identity: RunIdentity
  readonly controller: AbortController
  readonly settled: Promise<void>
  readonly resolve: () => void
  readonly steerSink?: (text: string) => boolean
  lifecycle: RunLifecycle
}

export function composeAbort(
  sources: readonly (AbortSignal | undefined)[],
  timeoutMs: number | undefined
): ComposedAbort {
  const controller = new AbortController()
  const live = sources.filter((source): source is AbortSignal => source !== undefined)
  const onAbort = (): void => controller.abort()

  // Guard before arming: an already-aborted source must not leave a timer or listener behind.
  if (live.some((source) => source.aborted)) {
    controller.abort()

    return { controller, deadline: NO_DEADLINE, dispose: noop }
  }

  for (const source of live) {
    source.addEventListener('abort', onAbort, { once: true })
  }

  const detach = (): void => {
    for (const source of live) {
      source.removeEventListener('abort', onAbort)
    }
  }

  if (timeoutMs === undefined || timeoutMs <= 0) {
    return { controller, deadline: NO_DEADLINE, dispose: detach }
  }

  let remainingMs = timeoutMs
  let startedAt = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined = armTimeout(controller, remainingMs)
  // Counted, not a flag: overlapping pauses would otherwise let the inner resume restart the clock
  // while an outer caller still holds it stopped.
  let pauses = 0
  // The run hands `deadline` to every tool, so a tool settling after finalize can still call in.
  // Without this a resume would arm a fresh timer against an already-torn-down composition.
  let disposed = false

  return {
    controller,
    deadline: {
      pause(): void {
        if (disposed || controller.signal.aborted) {
          return
        }

        pauses += 1

        if (pauses > 1) {
          return
        }

        clearTimeout(timer)
        timer = undefined
        remainingMs -= performance.now() - startedAt
      },

      resume(): void {
        if (disposed || pauses === 0 || controller.signal.aborted) {
          return
        }

        pauses -= 1

        if (pauses > 0 || timer !== undefined) {
          return
        }

        startedAt = performance.now()
        timer = armTimeout(controller, remainingMs)
      },
    },
    dispose(): void {
      disposed = true
      clearTimeout(timer)
      timer = undefined
      detach()
    },
  }
}

function armTimeout(controller: AbortController, ms: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => controller.abort(TIMEOUT_ABORT), ms).unref()
}

function abortChatEntries(
  runs: ReadonlyMap<RunId, RunEntry>,
  channel: ChannelId,
  chatId: string
): boolean {
  let aborted = false

  for (const entry of runs.values()) {
    const { identity } = entry

    if (
      identity.channel === channel &&
      identity.chatId === chatId &&
      ACTIVE_LIFECYCLES.has(entry.lifecycle)
    ) {
      entry.controller.abort()
      aborted = true
    }
  }

  return aborted
}

export function createRunRegistry(): RunTracker {
  const runs = new Map<RunId, RunEntry>()
  const bySession = new Map<SessionId, Set<RunId>>()
  let closing = false

  const settle = (entry: RunEntry, lifecycle: RunLifecycle): void => {
    entry.lifecycle = lifecycle
    entry.resolve()
    runs.delete(entry.identity.runId)
    dropSessionIndex(bySession, entry.identity)
  }

  return {
    register(identity, controller, steerSink): RunHandle {
      if (closing) {
        throw new RunHalted('abort', 'run registry is draining')
      }

      const entry = createEntry(identity, controller, steerSink)

      runs.set(identity.runId, entry)
      indexSession(bySession, identity)

      return {
        identity,
        get lifecycle(): RunLifecycle {
          return entry.lifecycle
        },
        abort: (): void => controller.abort(),
      }
    },

    abortSession(sessionId: SessionId, chatId: string): boolean {
      return abortChatRuns(runs, bySession.get(sessionId), chatId)
    },

    abortChat: (channel, chatId) => abortChatEntries(runs, channel, chatId),

    steer: (sessionId, chatId, text) =>
      steerChatRun(runs, bySession.get(sessionId), { chatId, text }),

    async drain(timeoutMs: number): Promise<void> {
      closing = true
      await drainActive(runs, settle, timeoutMs)
    },

    active(): readonly RunHandle[] {
      const handles: RunHandle[] = []

      for (const entry of runs.values()) {
        if (ACTIVE_LIFECYCLES.has(entry.lifecycle)) {
          handles.push(toHandle(entry))
        }
      }

      return handles
    },

    markDone(id: RunId, lifecycle: RunLifecycle): void {
      const entry = runs.get(id)

      if (entry === undefined) {
        return
      }

      settle(entry, lifecycle)
    },
  }
}

function createEntry(
  identity: RunIdentity,
  controller: AbortController,
  steerSink?: (text: string) => boolean
): RunEntry {
  let resolve = noop
  const settled = new Promise<void>((done) => {
    resolve = done
  })

  return {
    identity,
    controller,
    settled,
    resolve,
    lifecycle: 'running',
    ...(steerSink === undefined ? {} : { steerSink }),
  }
}

type SettleEntry = (entry: RunEntry, lifecycle: RunLifecycle) => void

// Abort every still-active run, race their settlement against a deadline, then settle any that
// ignored the abort so the maps empty and their settled promises resolve instead of pinning the
// entry forever.
async function drainActive(
  runs: Map<RunId, RunEntry>,
  settle: SettleEntry,
  timeoutMs: number
): Promise<void> {
  const pending: Promise<void>[] = []

  for (const entry of runs.values()) {
    if (ACTIVE_LIFECYCLES.has(entry.lifecycle)) {
      entry.controller.abort()
      pending.push(entry.settled)
    }
  }

  if (pending.length === 0) {
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined

  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs)
  })

  try {
    await Promise.race([Promise.all(pending), deadline])
  } finally {
    clearTimeout(timer)
  }

  for (const entry of runs.values()) {
    if (ACTIVE_LIFECYCLES.has(entry.lifecycle)) {
      settle(entry, 'aborted')
    }
  }
}

// A run records both session and origin chat, so knowing one cannot cancel another. Routed children
// use private sessions and inherit the parent signal even when they carry the parent chat route.
function abortChatRuns(
  runs: ReadonlyMap<RunId, RunEntry>,
  ids: ReadonlySet<RunId> | undefined,
  chatId: string
): boolean {
  let aborted = false

  for (const id of ids ?? []) {
    const entry = runs.get(id)

    if (entry?.identity.chatId !== chatId) {
      continue
    }

    entry.controller.abort()
    aborted = true
  }

  return aborted
}

// Same chat rule as abortChatRuns: a run only accepts steering from the chat it was started from.
// A sink that refuses means its turn loop has already exited, so the next entry gets the offer.
function steerChatRun(
  runs: ReadonlyMap<RunId, RunEntry>,
  ids: ReadonlySet<RunId> | undefined,
  input: { readonly chatId: string; readonly text: string }
): boolean {
  for (const id of ids ?? []) {
    const entry = runs.get(id)

    if (
      entry?.identity.chatId !== input.chatId ||
      !ACTIVE_LIFECYCLES.has(entry.lifecycle) ||
      entry.steerSink === undefined
    ) {
      continue
    }

    if (entry.steerSink(input.text)) {
      return true
    }
  }

  return false
}

function toHandle(entry: RunEntry): RunHandle {
  return {
    identity: entry.identity,
    get lifecycle(): RunLifecycle {
      return entry.lifecycle
    },
    abort: (): void => entry.controller.abort(),
  }
}

function indexSession(bySession: Map<SessionId, Set<RunId>>, identity: RunIdentity): void {
  const existing = bySession.get(identity.sessionId)

  if (existing === undefined) {
    bySession.set(identity.sessionId, new Set([identity.runId]))
    return
  }

  existing.add(identity.runId)
}

function dropSessionIndex(bySession: Map<SessionId, Set<RunId>>, identity: RunIdentity): void {
  const ids = bySession.get(identity.sessionId)

  if (ids === undefined) {
    return
  }

  ids.delete(identity.runId)

  if (ids.size === 0) {
    bySession.delete(identity.sessionId)
  }
}

function noop(): void {
  // no-op
}

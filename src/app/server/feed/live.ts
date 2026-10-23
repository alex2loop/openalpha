import type { WireEvent } from '@/app/server/wire/events'
import type { LiveRunWire, LiveSnapshotWire, ProgressWire } from '@/app/server/wire/live'
import type { EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { RunProgressMessage } from '@/engine/api'
import { toProgressWire } from '@/app/server/feed/progress'
import {
  PROGRESS_NORMALIZERS,
  toAgentRunWire,
  toCommandRunWire,
  WIRE_NORMALIZERS,
} from '@/app/server/ws/wire-events'

/** Bounds the map of runs a client can ask about; the oldest go first. */
const MAX_LIVE_RUNS = 200
const MAX_PERSISTENT_STEPS = 20

export interface LiveFeed {
  snapshot(): LiveSnapshotWire
  stop(): void
}

interface LiveFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
  readonly locale: Locale
  /** Whether the run is still running, by the run registry or the command dispatcher. */
  readonly isLive: (runId: RunId) => boolean
}

/** Follows every agent run and long-running command on the bus, tells open sockets as each moves,
 *  and answers "what is running now" for a client that connects late. The topics the socket already
 *  relays per connection are not touched here. */
export function createLiveFeed(deps: LiveFeedDeps): LiveFeed {
  const book = createRunBook(deps.isLive)
  const offs = [...followLifecycle(deps, book), ...followProgress(deps, book)]

  return {
    snapshot: () => ({ runs: book.live(), pending: [] }),
    stop: () => {
      for (const off of offs) {
        off()
      }

      book.clear()
    },
  }
}

function followLifecycle({ bus, broadcast }: LiveFeedDeps, book: RunBook): (() => void)[] {
  return [
    bus.on('run_started', (e) => {
      book.start(e.runId, {
        runId: e.runId,
        ...toAgentRunWire(e),
        agentId: e.agentId,
        persistent: [],
      })
      broadcast(WIRE_NORMALIZERS.run_started(e))
    }),
    bus.on('command_started', (e) => {
      book.start(e.runId, { runId: e.runId, ...toCommandRunWire(e), persistent: [] })
      broadcast(WIRE_NORMALIZERS.command_started(e))
    }),
    bus.on('run_finished', (e) => {
      book.finish(e.runId)
      broadcast(WIRE_NORMALIZERS.run_finished(e))
    }),
    bus.on('command_finished', (e) => {
      book.finish(e.runId)
      broadcast(WIRE_NORMALIZERS.command_finished(e))
    }),
  ]
}

function followProgress({ bus, broadcast, locale }: LiveFeedDeps, book: RunBook): (() => void)[] {
  const toProgress = (message: RunProgressMessage): ProgressWire | undefined =>
    toProgressWire(message, locale, Date.now())

  return [
    bus.on('run_progress', (e) => {
      const progress = toProgress(e.message)

      if (progress !== undefined) {
        book.report(e.runId, progress)
        broadcast(PROGRESS_NORMALIZERS.run_progress(e, progress))
      }
    }),
    bus.on('command_progress', (e) => {
      const progress = toProgress(e.message)

      if (progress !== undefined) {
        book.report(e.runId, progress)
        broadcast(PROGRESS_NORMALIZERS.command_progress(e, progress))
      }
    }),
    bus.on('run_thinking', (e) => {
      book.think(e.runId, e.excerpt)
      broadcast(WIRE_NORMALIZERS.run_thinking(e))
    }),
  ]
}

interface RunBook {
  start(runId: RunId, entry: LiveRunWire): void
  report(runId: RunId, progress: ProgressWire): void
  think(runId: RunId, excerpt: string): void
  finish(runId: RunId): void
  /** The runs still running, oldest first. */
  live(): readonly LiveRunWire[]
  clear(): void
}

function createRunBook(isLive: (runId: RunId) => boolean): RunBook {
  // Insertion order is start order, so the first key is the oldest run.
  const runs = new Map<RunId, LiveRunWire>()
  const trimOldest = (): void => {
    for (const runId of runs.keys()) {
      if (runs.size <= MAX_LIVE_RUNS) {
        return
      }

      runs.delete(runId)
    }
  }
  // A run that predates the feed is not in the map: its events are still broadcast.
  const update = (runId: RunId, change: (entry: LiveRunWire) => LiveRunWire): void => {
    const entry = runs.get(runId)

    if (entry !== undefined) {
      runs.set(runId, change(entry))
    }
  }

  return {
    start(runId, entry) {
      runs.set(runId, entry)
      trimOldest()
    },
    report: (runId, progress) => update(runId, (entry) => withProgress(entry, progress)),
    think: (runId, excerpt) => update(runId, (entry) => ({ ...entry, thinking: excerpt })),
    finish: (runId) => runs.delete(runId),
    live() {
      // A run whose finish event never came (a crash between hooks) leaves when its registry says so.
      for (const runId of runs.keys()) {
        if (!isLive(runId)) {
          runs.delete(runId)
        }
      }

      trimOldest()

      return [...runs.values()]
    },
    clear: () => runs.clear(),
  }
}

function withProgress(entry: LiveRunWire, progress: ProgressWire): LiveRunWire {
  return progress.mode === 'persistent'
    ? {
        ...entry,
        progress,
        persistent: [...entry.persistent, progress].slice(-MAX_PERSISTENT_STEPS),
      }
    : { ...entry, progress }
}

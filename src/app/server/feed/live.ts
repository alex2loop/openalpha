import type { WireEvent } from '@/app/server/wire/events'
import type { LiveRunWire, LiveSnapshotWire, ProgressWire } from '@/app/server/wire/live'
import type { EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { RunProgressMessage } from '@/engine/api'
import { createAlertsFeed } from '@/app/server/feed/alerts'
import { followBudget } from '@/app/server/feed/budget'
import { followFills } from '@/app/server/feed/fills'
import { createPendingFeed } from '@/app/server/feed/pending'
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
/** A transient progress line reaches the sockets at most this often per run; the snapshot always holds the latest. */
const LIVE_PROGRESS_MIN_INTERVAL_MS = 250

export interface LiveFeed {
  snapshot(): LiveSnapshotWire
  /** The raw channel an approval was asked on, or undefined for a request id the feed does not hold. */
  pendingOrigin(requestId: string): string | undefined
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
  const pending = createPendingFeed(deps)
  const alerts = createAlertsFeed(deps)
  const offs = [
    alerts.stop,
    ...followLifecycle(deps, book),
    ...followProgress(deps, book),
    ...followFills(deps),
    ...followBudget(deps),
  ]

  return {
    snapshot() {
      const alertsCheckedAt = alerts.checkedAt()

      return {
        runs: book.live(),
        pending: pending.list(),
        ...(alertsCheckedAt === undefined ? {} : { alertsCheckedAt }),
      }
    },
    pendingOrigin: pending.originOf,
    stop: () => {
      for (const off of offs) {
        off()
      }

      book.clear()
      pending.stop()
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

      if (progress !== undefined && book.report(e.runId, progress)) {
        broadcast(PROGRESS_NORMALIZERS.run_progress(e, progress))
      }
    }),
    bus.on('command_progress', (e) => {
      const progress = toProgress(e.message)

      if (progress !== undefined && book.report(e.runId, progress)) {
        broadcast(PROGRESS_NORMALIZERS.command_progress(e, progress))
      }
    }),
    bus.on('run_thinking', (e) => {
      book.think(e.runId, e.excerpt)

      const frame = WIRE_NORMALIZERS.run_thinking(e)

      broadcast({ ...frame, source: { ...frame.source, agentId: book.agentIdOf(e.runId) ?? '' } })
    }),
  ]
}

interface RunBook {
  start(runId: RunId, entry: LiveRunWire): void
  /** Records the newest line and says whether to broadcast it: a persistent step always, a transient
   *  one when LIVE_PROGRESS_MIN_INTERVAL_MS has passed since the run's last broadcast (a run the book
   *  does not hold always). A suppressed line is superseded by the next; no timer flushes it. */
  report(runId: RunId, progress: ProgressWire): boolean
  think(runId: RunId, excerpt: string): void
  /** The agent a held run belongs to, or undefined for a command or a run the book does not hold. */
  agentIdOf(runId: RunId): string | undefined
  finish(runId: RunId): void
  /** The runs still running, oldest first. */
  live(): readonly LiveRunWire[]
  clear(): void
}

interface BookEntry {
  readonly wire: LiveRunWire
  /** `performance.now()` of the last progress frame sent for this run. */
  readonly lastBroadcastAt: number | undefined
}

function createRunBook(isLive: (runId: RunId) => boolean): RunBook {
  // Insertion order is start order, so the first key is the oldest run.
  const runs = new Map<RunId, BookEntry>()
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
      runs.set(runId, { ...entry, wire: change(entry.wire) })
    }
  }

  return {
    start(runId, wire) {
      runs.set(runId, { wire, lastBroadcastAt: undefined })
      trimOldest()
    },
    report: (runId, progress) => reportTo(runs, runId, progress),
    think: (runId, excerpt) => update(runId, (entry) => ({ ...entry, thinking: excerpt })),
    agentIdOf: (runId) => runs.get(runId)?.wire.agentId,
    finish: (runId) => runs.delete(runId),
    live() {
      // A run whose finish event never came (a crash between hooks) leaves when its registry says so.
      for (const runId of runs.keys()) {
        if (!isLive(runId)) {
          runs.delete(runId)
        }
      }

      trimOldest()

      return [...runs.values()].map((entry) => entry.wire)
    },
    clear: () => runs.clear(),
  }
}

function reportTo(runs: Map<RunId, BookEntry>, runId: RunId, progress: ProgressWire): boolean {
  const entry = runs.get(runId)

  if (entry === undefined) {
    return true
  }

  const next = withReport(entry, progress, performance.now())

  runs.set(runId, next.entry)

  return next.due
}

function withReport(
  entry: BookEntry,
  progress: ProgressWire,
  now: number
): { readonly entry: BookEntry; readonly due: boolean } {
  const due =
    progress.mode === 'persistent' ||
    entry.lastBroadcastAt === undefined ||
    now - entry.lastBroadcastAt >= LIVE_PROGRESS_MIN_INTERVAL_MS

  return {
    due,
    entry: {
      wire: withProgress(entry.wire, progress),
      lastBroadcastAt: due ? now : entry.lastBroadcastAt,
    },
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

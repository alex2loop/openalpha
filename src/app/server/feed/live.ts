import type { WireEvent } from '@/app/server/wire/events'
import type { LiveRunWire, LiveSnapshotWire, ProgressWire } from '@/app/server/wire/live'
import type { BoardEntryWire } from '@/app/server/wire/notices'
import type { BusEventMap, EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { RunProgressMessage } from '@/engine/api'
import { createAlertsFeed } from '@/app/server/feed/alerts'
import {
  BOARD_SIZE,
  createResultBoard,
  type ResultBoard,
  toBoardText,
} from '@/app/server/feed/board'
import { followBudget } from '@/app/server/feed/budget'
import { followFills } from '@/app/server/feed/fills'
import { followNotices } from '@/app/server/feed/notices'
import { createPendingFeed } from '@/app/server/feed/pending'
import { toProgressWire } from '@/app/server/feed/progress'
import { withTicker } from '@/app/server/feed/tickers'
import { followTools } from '@/app/server/feed/tools'
import {
  PROGRESS_NORMALIZERS,
  toAgentRunWire,
  toCommandRunWire,
  WIRE_NORMALIZERS,
} from '@/app/server/ws/wire-events'
import { formatErrForLog } from '@/core/security/credentials'

/** Bounds the map of runs a client can ask about; the oldest go first. */
const MAX_LIVE_RUNS = 200
const MAX_PERSISTENT_STEPS = 20
/** A transient progress line reaches the sockets at most this often per run; the snapshot always holds the latest. */
const LIVE_PROGRESS_MIN_INTERVAL_MS = 250

export interface LiveFeed {
  snapshot(): LiveSnapshotWire
  /** The raw channel an approval was asked on, or undefined for a request id the feed does not hold. */
  pendingOrigin(requestId: string): string | undefined
  /** The last command answers, newest first; empty after a restart. */
  board(): readonly BoardEntryWire[]
  stop(): void
}

interface LiveFeedDeps {
  readonly bus: EventBus
  readonly broadcast: (event: WireEvent) => void
  readonly locale: Locale
  /** Whether the run is still running, by the run registry or the command dispatcher. */
  readonly isLive: (runId: RunId) => boolean
  readonly logger: Logger
  /** A command's description in the daemon's language; undefined for a name no command holds. */
  readonly describeCommand: (name: string) => string | undefined
}

/** Follows every agent run and long-running command on the bus, tells open sockets as each moves,
 *  and answers "what is running now" for a client that connects late. The topics the socket already
 *  relays per connection are not touched here. */
export function createLiveFeed(deps: LiveFeedDeps): LiveFeed {
  const book = createRunBook(deps.isLive)
  const board = createResultBoard(BOARD_SIZE)
  const pending = createPendingFeed(deps)
  const alerts = createAlertsFeed(deps)
  const offs = [
    alerts.stop,
    ...followLifecycle(deps, { book, board }),
    ...followProgress(deps, book),
    ...followTools(deps),
    ...followFills(deps),
    ...followBudget(deps),
    ...followNotices(deps),
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
    board: board.list,
    stop: () => {
      for (const off of offs) {
        off()
      }

      book.clear()
      pending.stop()
    },
  }
}

interface Lifecycle {
  readonly book: RunBook
  readonly board: ResultBoard
}

function followLifecycle(deps: LiveFeedDeps, { book, board }: Lifecycle): (() => void)[] {
  const { bus, broadcast } = deps
  let boardFailureLogged = false

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
      broadcast(withTickers(WIRE_NORMALIZERS.run_finished(e), book.finish(e.runId)))
    }),
    bus.on('command_finished', (e) => {
      const run = book.finish(e.runId)

      // The finish goes out first: a board entry that fails to render must not leave a ghost run.
      broadcast(withTickers(WIRE_NORMALIZERS.command_finished(e), run))

      try {
        noteResult(deps, board, { e, run })
      } catch (err: unknown) {
        if (!boardFailureLogged) {
          boardFailureLogged = true
          deps.logger.warn('api.board_render_failed', { err: formatErrForLog(err) })
        }
      }
    }),
  ]
}

/** The run's tickers ride its finish, so a page can pin the names a run worked on. */
function withTickers(event: WireEvent, run: LiveRunWire | undefined): WireEvent {
  return run?.tickers === undefined ? event : { ...event, tickers: run.tickers }
}

interface FinishedCommand {
  readonly e: BusEventMap['command_finished']
  /** Undefined for a command that started before the feed did: with no name it has no entry. */
  readonly run: LiveRunWire | undefined
}

/** Puts a finished command's answer on the board, as the chat got it. */
function noteResult(
  { locale, describeCommand }: LiveFeedDeps,
  board: ResultBoard,
  done: FinishedCommand
): void {
  const { e, run } = done
  const text = e.result === undefined ? undefined : toBoardText(e.result, locale)

  if (run !== undefined && text !== undefined) {
    board.add({
      runId: e.runId,
      name: run.name,
      channel: e.channel,
      finishedAt: Date.now(),
      title: describeCommand(run.name) ?? run.name,
      text,
      tickers: run.tickers ?? [],
    })
  }
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
  /** Forgets the run and returns what the book held of it. */
  finish(runId: RunId): LiveRunWire | undefined
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
    finish(runId) {
      const entry = runs.get(runId)

      runs.delete(runId)

      return entry?.wire
    },
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

function withProgress(run: LiveRunWire, progress: ProgressWire): LiveRunWire {
  const tickers = withTicker(run.tickers, progress)
  const entry = tickers === undefined ? run : { ...run, tickers }

  return progress.mode === 'persistent'
    ? {
        ...entry,
        progress,
        persistent: [...entry.persistent, progress].slice(-MAX_PERSISTENT_STEPS),
      }
    : { ...entry, progress }
}

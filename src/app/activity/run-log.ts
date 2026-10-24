import type { App } from '@/core/container'
import type { BusEventMap, EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { RunProgressMessage } from '@/engine/api'
import type { RunLogRow } from '@/persistence/api'
import { formatErrForLog } from '@/core/security/credentials'

/** Runs that have started and not finished. A run whose finish never arrives is dropped oldest first. */
const MAX_OPEN_RUNS = 500
const RESEARCH_TOTALS_KEY = 'progress.researchTotals'

/** A run's start, held until its finish says how it ended. */
type OpenRun = Omit<RunLogRow, 'endedAt' | 'outcome'>

export interface RunLog {
  /** Stops listening, then waits for every write already begun. Safe to call twice. */
  stop(): Promise<void>
}

/** Writes one row per finished run, in every process that boots the app: a `chat -m` process exits
 *  right after its command finishes, so the caller awaits `stop` before closing storage.
 *
 *  Not written: a command whose result hands the turn to an agent (the agent run is the row), and an
 *  agent run whose answer never reaches a surface unless it is a child of another run. */
export function startRunLog(app: App): RunLog {
  const bus = app.resolve('bus')
  const store = app.resolve('runLogStore')
  const logger = app.resolve('logger')
  const open = new Map<RunId, OpenRun>()
  const writes = new Set<Promise<void>>()
  let failureLogged = false

  const write = (row: RunLogRow): void => {
    const pending = store
      .record(row)
      .catch((err: unknown) => {
        if (!failureLogged) {
          failureLogged = true
          logger.warn('activity.run_log_failed', { err: formatErrForLog(err) })
        }
      })
      .finally(() => {
        writes.delete(pending)
      })

    writes.add(pending)
  }
  const offs = followRuns(bus, { open, write })

  return {
    stop: async () => {
      for (const off of offs) {
        off()
      }

      open.clear()
      await Promise.all(writes)
    },
  }
}

interface RunBook {
  readonly open: Map<RunId, OpenRun>
  readonly write: (row: RunLogRow) => void
}

function followRuns(bus: EventBus, book: RunBook): (() => void)[] {
  const { open } = book

  return [
    bus.on('run_started', (e) => {
      if (e.hidden === undefined || e.parentRunId !== undefined) {
        remember(open, toAgentStart(e))
      }
    }),
    bus.on('command_started', (e) => remember(open, toCommandStart(e))),
    bus.on('run_progress', (e) => noteSources(open, e.runId, e.message)),
    bus.on('run_finished', (e) =>
      finish(book, e.runId, {
        outcome: e.reason,
        ...(e.summary === undefined ? {} : { summary: e.summary }),
      })
    ),
    bus.on('command_finished', (e) => {
      if (e.result?.kind === 'agent') {
        open.delete(e.runId)

        return
      }

      finish(book, e.runId, { outcome: e.outcome })
    }),
  ]
}

function remember(open: Map<RunId, OpenRun>, run: OpenRun): void {
  open.set(run.runId, run)

  // Insertion order is start order, so the first key is the oldest.
  for (const oldest of open.keys()) {
    if (open.size <= MAX_OPEN_RUNS) {
      return
    }

    open.delete(oldest)
  }
}

function noteSources(open: Map<RunId, OpenRun>, id: RunId, message: RunProgressMessage): void {
  const run = open.get(id)
  const sources = message.key === RESEARCH_TOTALS_KEY ? message.params?.admittedSources : undefined

  if (run !== undefined && typeof sources === 'number') {
    open.set(id, { ...run, sources })
  }
}

interface RunEnd {
  readonly outcome: string
  readonly summary?: string
}

function finish(book: RunBook, id: RunId, end: RunEnd): void {
  const run = book.open.get(id)

  if (run === undefined) {
    return
  }

  book.open.delete(id)
  book.write({ ...run, endedAt: Date.now(), ...end })
}

function toAgentStart(e: BusEventMap['run_started']): OpenRun {
  return {
    runId: e.runId,
    kind: 'agent',
    name: e.agentId,
    ...(e.title === undefined ? {} : { title: e.title }),
    agentId: e.agentId,
    channel: e.channel,
    ...(e.chatId === undefined ? {} : { chatId: e.chatId }),
    sessionId: e.sessionId,
    ...(e.parentRunId === undefined ? {} : { parentRunId: e.parentRunId }),
    startedAt: e.startedAt,
  }
}

function toCommandStart(e: BusEventMap['command_started']): OpenRun {
  return {
    runId: e.runId,
    kind: 'command',
    name: e.name,
    channel: e.channel,
    chatId: e.chatId,
    sessionId: e.sessionId,
    startedAt: e.startedAt,
  }
}

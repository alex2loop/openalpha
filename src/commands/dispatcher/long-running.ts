import { randomUUID } from 'node:crypto'

import type { ChannelId } from '@/core/channels'
import type { BusEventMap, EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type {
  ProgressReporter,
  ScheduledRequest,
  ScheduledRun,
  ScheduledRunner,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import '@/commands/events'
import { SCHEDULE_CHANNEL } from '@/core/channels'
import { isAbortError, RunHalted } from '@/core/errors'
import { runId, sessionId } from '@/core/ids'

import { toSlashResult } from './result'

const MAX_ACTIVE_COMMANDS = 200
/** A run the daemon starts on its own answers in no chat and belongs to no conversation. */
const SCHEDULE_CHAT_ID = 'schedule'
const SCHEDULE_SESSION_ID = sessionId('schedule')

const noop = (): void => undefined

type CommandOutcome = BusEventMap['command_finished']['outcome']

interface CommandRunsDeps {
  readonly bus: EventBus
  readonly logger: Logger
}

export interface CommandRuns {
  /** Runs `command` as a long-running command: mints its run id, publishes its lifecycle on the
   *  bus and registers it so `abortCommand` can stop it. Returns the validated result. */
  withCommandEvents(context: SlashContext, command: SlashCommand): Promise<SlashResult>
  /** Runs work the daemon starts on its own the same way, on the schedule's channel. */
  readonly runScheduled: ScheduledRunner
  abortCommand(id: RunId): boolean
  activeCommands(): readonly RunId[]
}

interface CommandRunState {
  readonly bus: EventBus
  readonly active: Map<RunId, AbortController>
  track(id: RunId, controller: AbortController): void
}

interface RunStart {
  readonly id: RunId
  readonly name: string
  readonly channel: ChannelId
  readonly chatId: string
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  /** The surface's own reporter, told each stage before the bus is. */
  readonly progress?: ProgressReporter
}

interface TrackedRun extends ScheduledRun {
  readonly runId: RunId
}

interface RunBody<T> {
  work(run: TrackedRun): Promise<T>
  /** The reply the finish carries, read in-process only. */
  resultOf(value: T): SlashResult | undefined
  isIdle?(value: T): boolean
  /** Announced at its first stage rather than at once, so work that finds nothing to do never
   *  shows as running. */
  readonly startsAtFirstStage?: true
}

export function createCommandRuns(deps: CommandRunsDeps): CommandRuns {
  const active = new Map<RunId, AbortController>()
  let overflowLogged = false

  const state: CommandRunState = {
    bus: deps.bus,
    active,
    track(id, controller) {
      if (active.size < MAX_ACTIVE_COMMANDS) {
        active.set(id, controller)
        return
      }

      if (!overflowLogged) {
        overflowLogged = true
        deps.logger.warn('commands.active_overflow', { limit: MAX_ACTIVE_COMMANDS })
      }
    },
  }

  return {
    withCommandEvents: (context, command) => runWithEvents(state, context, command),
    runScheduled: (request) => runScheduled(state, request),
    abortCommand(id) {
      const controller = active.get(id)

      if (controller === undefined) {
        return false
      }

      // The context carries only the surface's signal, never a controller to abort, so aborting the
      // child stops the command and leaves the surface's own signal untouched.
      controller.abort()
      return true
    },
    activeCommands: () => [...active.keys()],
  }
}

async function runWithEvents(
  state: CommandRunState,
  context: SlashContext,
  command: SlashCommand
): Promise<SlashResult> {
  const start: RunStart = {
    id: context.runId ?? runId(randomUUID()),
    name: command.name,
    channel: context.channel,
    chatId: context.chatId,
    sessionId: context.sessionId,
    signal: context.signal,
    ...(context.progress === undefined ? {} : { progress: context.progress }),
  }

  return await trackRun(state, start, {
    work: async (run) => {
      const raw = await command.run({ ...context, ...run })

      // A command that swallows its abort and returns normally reports completed.
      return toSlashResult(command, raw)
    },
    resultOf: (result) => result,
  })
}

function runScheduled<T>(state: CommandRunState, request: ScheduledRequest<T>): Promise<T> {
  const scheduled: RunStart = {
    name: request.name,
    signal: request.signal,
    id: runId(randomUUID()),
    channel: SCHEDULE_CHANNEL,
    chatId: SCHEDULE_CHAT_ID,
    sessionId: SCHEDULE_SESSION_ID,
  }

  return trackRun(state, scheduled, {
    work: (run) => request.work(run),
    resultOf: () => undefined,
    isIdle: (value) => request.isIdle?.(value) === true,
    startsAtFirstStage: true,
  })
}

/** One owner of a command run's lifecycle: registers the run so `abortCommand` can
 *  stop it, and publishes its start, its stages and how it ended on the bus. */
async function trackRun<T>(state: CommandRunState, start: RunStart, body: RunBody<T>): Promise<T> {
  const { id } = start
  const child = new AbortController()
  const unlink = linkAbort(start.signal, child)
  const { bus } = state
  const shown = createAnnouncer(bus, start)
  let outcome: CommandOutcome = 'error'
  let result: SlashResult | undefined
  let idle = false

  state.track(id, child)

  if (body.startsAtFirstStage !== true) {
    shown.announce()
  }

  try {
    const value = await body.work({
      runId: id,
      signal: child.signal,
      progress: reportProgress(bus, { start, announce: shown.announce }),
    })

    result = body.resultOf(value)
    idle = body.isIdle?.(value) === true
    outcome = 'completed'

    return value
  } catch (err: unknown) {
    if (isCancellation(err)) {
      outcome = 'aborted'
    }
    throw err
  } finally {
    unlink()
    state.active.delete(id)
    announceFinish(bus, { start, shown, outcome, result, idle })
  }
}

interface Announcer {
  /** Publishes the start once, stamped with when the run began. */
  announce(): void
  isAnnounced(): boolean
}

function createAnnouncer(bus: EventBus, start: RunStart): Announcer {
  const startedAt = Date.now()
  let announced = false

  return {
    announce() {
      if (!announced) {
        announced = true
        announceStart(bus, start, startedAt)
      }
    },
    isAnnounced: () => announced,
  }
}

function announceStart(bus: EventBus, start: RunStart, startedAt: number): void {
  bus.emit('command_started', {
    runId: start.id,
    name: start.name,
    channel: start.channel,
    chatId: start.chatId,
    sessionId: start.sessionId,
    startedAt,
  })
}

interface RunFinish {
  readonly start: RunStart
  readonly shown: Announcer
  readonly outcome: CommandOutcome
  readonly result: SlashResult | undefined
  readonly idle: boolean
}

// A quiet start that found nothing to do was never shown, so it leaves no trace.
function announceFinish(bus: EventBus, finish: RunFinish): void {
  const { shown, idle, result } = finish

  if (!shown.isAnnounced() && idle) {
    return
  }

  shown.announce()
  bus.emit('command_finished', {
    runId: finish.start.id,
    channel: finish.start.channel,
    outcome: finish.outcome,
    ...(result === undefined ? {} : { result }),
    ...(idle ? { idle: true } : {}),
  })
}

// Forwards to the surface's own reporter, then publishes the same stage on the bus, announcing a
// quiet start first.
function reportProgress(
  bus: EventBus,
  run: { readonly start: RunStart; readonly announce: () => void }
): ProgressReporter {
  const { start } = run

  return (key, params) => {
    run.announce()
    start.progress?.(key, params)
    bus.emit('command_progress', {
      runId: start.id,
      channel: start.channel,
      message: { key, ...(params === undefined ? {} : { params }), mode: 'transient' },
    })
  }
}

function linkAbort(source: AbortSignal, target: AbortController): () => void {
  const onAbort = (): void => target.abort(source.reason)

  if (source.aborted) {
    onAbort()
    return noop
  }

  source.addEventListener('abort', onAbort, { once: true })

  return () => source.removeEventListener('abort', onAbort)
}

// Both cancellation shapes a command can raise: a native fetch/stream abort, and the runtime's
// own typed halt from `abortError`.
export function isCancellation(err: unknown): boolean {
  if (err instanceof RunHalted) {
    return err.code === 'abort'
  }

  return isAbortError(err)
}

import { randomUUID } from 'node:crypto'

import type { ChannelId } from '@/core/channels'
import type { BusEventMap, EventBus } from '@/core/events'
import type { RunId, SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type {
  ProgressReporter,
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
    runScheduled: (name, signal, work) => runScheduled(state, { name, signal }, work),
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

function runScheduled<T>(
  state: CommandRunState,
  start: Pick<RunStart, 'name' | 'signal'>,
  work: (run: ScheduledRun) => Promise<T>
): Promise<T> {
  const scheduled: RunStart = {
    ...start,
    id: runId(randomUUID()),
    channel: SCHEDULE_CHANNEL,
    chatId: SCHEDULE_CHAT_ID,
    sessionId: SCHEDULE_SESSION_ID,
  }

  return trackRun(state, scheduled, { work, resultOf: () => undefined })
}

/** One owner of a command run's lifecycle: registers the run so `abortCommand` can
 *  stop it, and publishes its start, its stages and how it ended on the bus. */
async function trackRun<T>(state: CommandRunState, start: RunStart, body: RunBody<T>): Promise<T> {
  const { id, channel } = start
  const child = new AbortController()
  const unlink = linkAbort(start.signal, child)
  const { bus } = state
  let outcome: CommandOutcome = 'error'
  let result: SlashResult | undefined

  state.track(id, child)
  bus.emit('command_started', {
    runId: id,
    name: start.name,
    channel,
    chatId: start.chatId,
    sessionId: start.sessionId,
    startedAt: Date.now(),
  })

  try {
    const value = await body.work({
      runId: id,
      signal: child.signal,
      progress: reportProgress(bus, start),
    })

    result = body.resultOf(value)
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
    bus.emit('command_finished', {
      runId: id,
      channel,
      outcome,
      ...(result === undefined ? {} : { result }),
    })
  }
}

// Forwards to the surface's own reporter, then publishes the same stage on the bus.
function reportProgress(bus: EventBus, start: RunStart): ProgressReporter {
  return (key, params) => {
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

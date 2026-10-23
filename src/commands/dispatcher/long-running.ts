import { randomUUID } from 'node:crypto'

import type { BusEventMap, EventBus } from '@/core/events'
import type { RunId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type {
  ProgressReporter,
  SlashCommand,
  SlashContext,
  SlashResult,
} from '@/core/types/command'
import '@/commands/events'
import { isAbortError, RunHalted } from '@/core/errors'
import { runId } from '@/core/ids'

import { toSlashResult } from './result'

const MAX_ACTIVE_COMMANDS = 200

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
  abortCommand(id: RunId): boolean
  activeCommands(): readonly RunId[]
}

interface CommandRunState extends CommandRunsDeps {
  readonly active: Map<RunId, AbortController>
  track(id: RunId, controller: AbortController): void
}

export function createCommandRuns(deps: CommandRunsDeps): CommandRuns {
  const active = new Map<RunId, AbortController>()
  let overflowLogged = false

  const state: CommandRunState = {
    ...deps,
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
  const id = runId(randomUUID())
  const child = new AbortController()
  const unlink = linkAbort(context.signal, child)
  const { bus } = state
  let outcome: CommandOutcome = 'failed'
  let result: SlashResult | undefined

  state.track(id, child)
  bus.emit('command_started', {
    runId: id,
    name: command.name,
    channel: context.channel,
    chatId: context.chatId,
    sessionId: context.sessionId,
    startedAt: Date.now(),
  })

  try {
    const raw = await command.run({
      ...context,
      runId: id,
      signal: child.signal,
      progress: reportProgress(bus, context, id),
    })
    // A command that swallows its abort and returns normally reports done.
    result = toSlashResult(command, raw)
    outcome = 'done'

    return result
  } catch (err: unknown) {
    if (isCancellation(err)) {
      outcome = 'cancelled'
    }
    throw err
  } finally {
    unlink()
    state.active.delete(id)
    bus.emit('command_finished', {
      runId: id,
      channel: context.channel,
      outcome,
      ...(result === undefined ? {} : { result }),
    })
  }
}

// Forwards to the surface's own reporter, then publishes the same stage on the bus.
function reportProgress(bus: EventBus, context: SlashContext, id: RunId): ProgressReporter {
  return (key, params) => {
    context.progress?.(key, params)
    bus.emit('command_progress', {
      runId: id,
      channel: context.channel,
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

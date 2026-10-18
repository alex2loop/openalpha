import type { ChannelRuntimeDeps, Pipeline } from '@/channels/pipeline'
import type {
  ChannelAdapter,
  ChannelCommandMenu,
  ChannelMenuAudience,
  ChannelMenuCommand,
  ChannelRuntime,
  ChannelStatus,
} from '@/channels/types'
import type { CommandRole } from '@/core/types/command'
import { runInboxDrain } from '@/channels/delivery/inbox-drain'
import { sendChunked } from '@/channels/delivery/outbound/chunked-send'
import { createPipeline } from '@/channels/pipeline'
import { describeCommand } from '@/commands/api'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

// Time we are willing to wait for the inbox drain to settle after the adapter has disposed. Past this the
// runtime is considered stopped, but the late-settling task is still observed so it cannot leak silently.
const CHANNEL_DRAIN_TIMEOUT_MS = 5_000

interface RuntimeState {
  status: ChannelStatus
  drainTask: Promise<void> | null
  disposed: boolean
}

export function createChannelRuntime(deps: ChannelRuntimeDeps): ChannelRuntime {
  const runtimeAbort = new AbortController()
  const runtimeSignal = AbortSignal.any([deps.shutdownSignal, runtimeAbort.signal])
  const runtimeDeps: ChannelRuntimeDeps = { ...deps, shutdownSignal: runtimeSignal }
  const { adapter } = deps
  const pipeline = createPipeline(runtimeDeps)
  const state: RuntimeState = {
    status: { running: false, connected: false, lastError: null },
    drainTask: null,
    disposed: false,
  }

  return {
    channelId: adapter.id,
    start: () => startChannel({ deps: runtimeDeps, adapter, pipeline, state }),
    dispose: () =>
      disposeChannel({ deps: runtimeDeps, adapter, parts: pipeline, runtimeAbort, state }),
    snapshot: () => ({ channel: adapter.id, ...state.status }),
    isBusy: pipeline.isBusy,
    notify: async (target, text, signal) => {
      const outcome = await sendChunked(
        { notifier: pipeline.notifier, adapter, settings: deps.settings },
        { target, text, markup: true, ...(signal === undefined ? {} : { signal }) }
      )

      if (outcome === 'delivered') {
        return 'accepted'
      }
      return outcome === 'aborted' ? 'aborted' : 'unavailable'
    },
  }
}

async function startChannel(options: StartChannelOptions): Promise<void> {
  const { deps, adapter, pipeline, state } = options
  const { handler, gate } = pipeline
  state.status = { ...state.status, running: true, lastStartAt: Date.now() }

  await adapter.start(
    {
      onMessage: handler.handleMessage,
      onCallback: handler.handleCallback,
      canAdmit: gate.canAdmit,
      setStatus: (next) => {
        state.status = { ...state.status, ...next }
      },
      commandsForMenu: () => menuCommands(deps),
    },
    deps.shutdownSignal
  )

  state.drainTask = observeDrain(
    deps,
    runInboxDrain({
      handler,
      inbox: deps.inbox,
      inboxMaxAttempts: deps.inboxMaxAttempts,
      runMaxDurationMs: deps.runMaxDurationMs,
      channelId: adapter.id,
      logger: deps.logger,
      signal: deps.shutdownSignal,
    })
  )
}

interface StartChannelOptions {
  readonly deps: ChannelRuntimeDeps
  readonly adapter: ChannelAdapter
  readonly pipeline: Pipeline
  readonly state: RuntimeState
}

interface DisposeChannelOptions {
  readonly deps: ChannelRuntimeDeps
  readonly adapter: ChannelAdapter
  readonly parts: Pipeline
  readonly runtimeAbort: AbortController
  readonly state: RuntimeState
}

// Idempotent and non-throwing: a failed start must still tear down cleanly.
async function disposeChannel(options: DisposeChannelOptions): Promise<void> {
  const { deps, adapter, parts, runtimeAbort, state } = options

  if (state.disposed) {
    return
  }
  state.disposed = true

  runtimeAbort.abort()
  parts.handler.dispose()
  parts.proactive.dispose()
  parts.planReviewer.dispose()
  await closeQuietly(deps, 'queue', () => parts.queue.dispose())
  await closeQuietly(deps, 'adapter', () => adapter.dispose())

  let drainTimedOut = false

  if (state.drainTask) {
    try {
      drainTimedOut = !(await awaitDrainWithTimeout(deps, state.drainTask))
    } catch (err: unknown) {
      deps.logger.warn('channel.drain_wait_failed', {
        channel: adapter.id,
        err: formatErrForLog(err),
      })
    }
  }

  await closeQuietly(deps, 'notifier', () => parts.notifier.dispose())

  state.status = {
    ...state.status,
    running: false,
    connected: false,
    lastError: drainTimedOut ? 'inbox drain timed out' : state.status.lastError,
    lastStopAt: Date.now(),
  }
}

function observeDrain(deps: ChannelRuntimeDeps, task: Promise<void>): Promise<void> {
  return task.catch((err: unknown) => {
    if (!deps.shutdownSignal.aborted) {
      deps.logger.error('inbound.drain_terminated', {
        channel: deps.adapter.id,
        err: formatErrForLog(err),
      })
    }
  })
}

// Returns true if the drain settled before the deadline. On timeout, resolves false and keeps a
// handler that logs any late settlement without touching disposed status or storage.
function awaitDrainWithTimeout(
  deps: ChannelRuntimeDeps,
  drainTask: Promise<void>
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    const timer = setTimeout(() => {
      resolved = true
      resolve(false)
    }, CHANNEL_DRAIN_TIMEOUT_MS)
    drainTask.then(() => {
      if (resolved) {
        deps.logger.warn('channel.drain_late_settlement', { channel: deps.adapter.id })
        return
      }
      clearTimeout(timer)
      resolve(true)
    })
  })
}

async function closeQuietly(
  deps: ChannelRuntimeDeps,
  what: string,
  close: () => Promise<void>
): Promise<void> {
  try {
    await close()
  } catch (err: unknown) {
    deps.logger.warn('channel.dispose_failed', {
      channel: deps.adapter.id,
      what,
      err: formatErrForLog(err),
    })
  }
}

// Two menus: the list every chat may run, then the operator list layered over the chats that may
// run it. Descriptions share the single scrubbing render path (localized key or bounded plugin text).
function menuCommands(deps: ChannelRuntimeDeps): readonly ChannelCommandMenu[] {
  return [
    { audience: { kind: 'everyone' }, commands: visibleCommands(deps, 'member') },
    {
      audience: operatorAudience(deps.operatorUserIds),
      commands: visibleCommands(deps, 'operator'),
    },
  ]
}

function visibleCommands(
  deps: ChannelRuntimeDeps,
  role: CommandRole
): readonly ChannelMenuCommand[] {
  const locale = bindLocale(deps.locale)

  return deps.dispatcher.all('channel', role).map((cmd) => ({
    name: cmd.name,
    description: describeCommand(locale, cmd.description),
  }))
}

// A configured list names the operators outright; without one the gate treats every direct chat as
// its own operator, and no group member as one.
function operatorAudience(operatorUserIds: readonly string[]): ChannelMenuAudience {
  return operatorUserIds.length === 0
    ? { kind: 'directChats' }
    : { kind: 'chats', chatIds: operatorUserIds }
}

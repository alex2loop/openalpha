import type { AgentId } from '@/core/ids'

import type { OwnedLogDestination } from './types'
import { STDERR_LOG_STREAM } from './destination'

const AGENT_PENDING_RECORDS = 64
const AGENT_PENDING_BYTES = 262_144

export const AGENT_LOG_DROP_POLICY = Object.freeze({
  policy: 'drop_newest',
  pendingRecords: AGENT_PENDING_RECORDS,
  pendingBytes: AGENT_PENDING_BYTES,
})

export interface AgentLogSink {
  write(record: string): void
  flush(): Promise<void>
  close(): Promise<void>
  forceClose(): void
}

interface AgentRoute {
  readonly pending: string[]
  pendingBytes: number
  sink?: AgentLogSink
  opening?: Promise<AgentLogSink>
  failed?: true
}

interface RouterState {
  accepting: boolean
  terminal: boolean
  configured: boolean
  warned: boolean
}

interface RouterContext {
  state: RouterState
  openSink: (agentId: AgentId) => Promise<AgentLogSink>
  drop: () => void
}

export interface AgentLogRouter {
  readonly destination: OwnedLogDestination
  configure(agentIds: Iterable<string>): Promise<void>
  /** Gives each id without a route one and opens its sink; a route already there is left alone. */
  addAgentRoutes(agentIds: Iterable<AgentId>): Promise<void>
  setDropWarning(warn: () => void): void
  /** Scopes `fn`'s synchronous writes to `id` for routing, in place of re-parsing each record. */
  withAgentId<T>(id: AgentId | undefined, fn: () => T): T
}

export function createAgentLogRouter(
  global: OwnedLogDestination | undefined,
  openSink: (agentId: AgentId) => Promise<AgentLogSink>
): AgentLogRouter {
  const routes = new Map<AgentId, AgentRoute>()
  const state: RouterState = { accepting: true, terminal: false, configured: false, warned: false }
  const agentIdScope = createAgentIdScope()
  const dropWarning = createDropWarning(state)
  const ctx: RouterContext = { state, openSink, drop: dropWarning.drop }
  const routeRecord = createRouteRecord(routes, agentIdScope, ctx)
  const settleOpenings = async (): Promise<void> => {
    await Promise.allSettled([...routes.values()].map((route) => route.opening))
  }
  const flushAgents = async (): Promise<void> => {
    await settleOpenings()
    await Promise.allSettled([...routes.values()].map((route) => route.sink?.flush()))
  }
  const closeAgents = async (): Promise<void> => {
    await settleOpenings()
    await Promise.allSettled([...routes.values()].map((route) => route.sink?.close()))
  }
  const destination = agentRoutingDestination({
    global,
    state,
    routes,
    routeRecord,
    flushAgents,
    closeAgents,
  })

  return {
    destination,
    configure: async (agentIds) => {
      configureRoutes(state, routes, agentIds)
      await openAllRoutes(ctx, routes)
    },
    addAgentRoutes: (agentIds) => openAdded(ctx, routes, agentIds),
    setDropWarning: dropWarning.set,
    withAgentId: agentIdScope.withAgentId,
  }
}

function createDropWarning(state: RouterState): {
  readonly drop: () => void
  readonly set: (warn: () => void) => void
} {
  let warn = (): void => undefined

  return {
    drop: () => {
      if (!state.warned) {
        state.warned = true
        warn()
      }
    },
    set: (next) => {
      warn = next
    },
  }
}

function createRouteRecord(
  routes: ReadonlyMap<AgentId, AgentRoute>,
  agentIdScope: { current(): AgentId | undefined },
  ctx: RouterContext
): (record: string) => void {
  return (record) => {
    const id = agentIdScope.current()

    if (!ctx.state.accepting || id === undefined) {
      return
    }

    const route = routes.get(id)

    if (route === undefined) {
      return
    }

    if (route.sink !== undefined) {
      route.sink.write(record)
      return
    }

    if (route.failed === true) {
      ctx.drop()
      return
    }

    queueRecord(route, record, ctx.drop)
    ensureSink(ctx, route, id).catch(() => undefined)
  }
}

// A scope, not a plain module-level variable: each router owns its own, so writes on one router's
// call stack cannot be misattributed by another. `current` is only ever set for the extent of the
// synchronous `fn` a pino write happens inside, restoring the previous value on the way out so
// nested scopes (a child logger with its own agentId, or none) compose correctly.
function createAgentIdScope(): {
  current(): AgentId | undefined
  withAgentId<T>(id: AgentId | undefined, fn: () => T): T
} {
  let active: AgentId | undefined

  return {
    current: () => active,
    withAgentId: (id, fn) => {
      if (id === undefined) {
        return fn()
      }

      const previous = active
      active = id
      try {
        return fn()
      } finally {
        active = previous
      }
    },
  }
}

function agentRoutingDestination(options: {
  readonly global: OwnedLogDestination | undefined
  readonly state: RouterState
  readonly routes: ReadonlyMap<string, AgentRoute>
  readonly routeRecord: (record: string) => void
  readonly flushAgents: () => Promise<void>
  readonly closeAgents: () => Promise<void>
}): OwnedLogDestination {
  return {
    stream: {
      write: (record) => {
        if (options.global === undefined) {
          STDERR_LOG_STREAM.write(record)
        } else {
          options.global.stream.write(record)
        }

        options.routeRecord(record)
      },
    },
    isAvailable: () =>
      options.state.accepting && !options.state.terminal && (options.global?.isAvailable() ?? true),
    stopWrites: () => {
      options.state.accepting = false
      options.global?.stopWrites()
    },
    flush: async () => {
      await options.flushAgents()
      await options.global?.flush()
    },
    close: async () => {
      options.state.accepting = false
      await options.closeAgents()
      await options.global?.close()
    },
    forceClose: () => {
      options.state.terminal = true
      options.state.accepting = false
      for (const route of options.routes.values()) {
        route.sink?.forceClose()
      }
      options.global?.forceClose()
    },
  }
}

function configureRoutes(
  state: { configured: boolean },
  routes: Map<string, AgentRoute>,
  agentIds: Iterable<string>
): void {
  if (state.configured) {
    return
  }

  state.configured = true
  for (const id of agentIds) {
    routes.set(id, { pending: [], pendingBytes: 0 })
  }
}

// Only ids with no route get one, so a sink already open keeps its handle and its pending records.
// Once writes stop there is nothing to route to, and a sink opened now would outlive the close.
function openAdded(
  ctx: RouterContext,
  routes: Map<AgentId, AgentRoute>,
  agentIds: Iterable<AgentId>
): Promise<void> {
  if (!ctx.state.accepting || ctx.state.terminal) {
    return Promise.resolve()
  }

  const added: [AgentId, AgentRoute][] = []

  for (const id of agentIds) {
    if (!routes.has(id)) {
      added.push([id, { pending: [], pendingBytes: 0 }])
    }
  }

  for (const [id, route] of added) {
    routes.set(id, route)
  }

  return Promise.allSettled(added.map(([id, route]) => ensureSink(ctx, route, id))).then(
    () => undefined
  )
}

function openAllRoutes(
  ctx: RouterContext,
  routes: ReadonlyMap<AgentId, AgentRoute>
): Promise<void> {
  const tasks = [...routes.entries()].map(([id, route]) => ensureSink(ctx, route, id))
  return Promise.allSettled(tasks).then(() => undefined)
}

async function ensureSink(ctx: RouterContext, route: AgentRoute, id: AgentId): Promise<void> {
  const { state, openSink, drop } = ctx

  // Opening reaches sync fs, so a route that failed its boot open is not reopened per record.
  if (route.sink !== undefined || route.failed === true) {
    return
  }

  if (route.opening !== undefined) {
    await route.opening
    return
  }

  const task = openSink(id)
  route.opening = task
  try {
    const sink = await task

    if (state.terminal) {
      closeSinkQuietly(sink)
      return
    }
    installSink(route, sink)
  } catch {
    route.failed = true
    discardPending(route, drop)
  } finally {
    if (route.opening === task) {
      delete route.opening
    }
  }
}

function closeSinkQuietly(sink: AgentLogSink): void {
  try {
    sink.forceClose()
  } catch {
    // Best-effort cleanup after terminal shutdown.
  }
}

function queueRecord(route: AgentRoute, record: string, drop: () => void): void {
  const bytes = Buffer.byteLength(record)

  if (
    route.pending.length >= AGENT_PENDING_RECORDS ||
    route.pendingBytes + bytes > AGENT_PENDING_BYTES
  ) {
    drop()
    return
  }

  route.pending.push(record)
  route.pendingBytes += bytes
}

function installSink(route: AgentRoute, sink: AgentLogSink): void {
  route.sink = sink
  for (const record of route.pending) {
    sink.write(record)
  }
  route.pending.length = 0
  route.pendingBytes = 0
}

function discardPending(route: AgentRoute, drop: () => void): void {
  route.pending.length = 0
  route.pendingBytes = 0
  drop()
}

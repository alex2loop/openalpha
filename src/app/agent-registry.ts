import type { App, ServiceProvider, Services } from '@/core/container'
import type { AgentId } from '@/core/ids'
import type { LoggerResource } from '@/core/logging/logger'
import type { AgentBuildContext, AgentProfile, UserAgentSource } from '@/engine/api'
import { ConfigError } from '@/core/errors'
import { agentId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import {
  assertAgentTomlMatchesSourceId,
  buildUserAgents,
  loadAgentFromText,
  readUserAgents,
  userAgentsDir,
} from '@/engine/api'
import { validateAgentFocus } from '@/trading/api'

declare module '@/core/container' {
  interface Services {
    /** The holder behind `agents`: one stable map that a reload re-points. */
    liveAgents: LiveAgents
    /** The ids of the operator's own agents, which the built-ins and plugin agents are not: the only
     *  ones that can be paused or join a social network. Read per call: a reload changes them. */
    userAgentIds: () => ReadonlySet<AgentId>
    /** The log router's reach, so a reload can open routes for agents born after boot. */
    agentLogs: Pick<LoggerResource, 'addAgentRoutes'>
  }
}

interface SkippedAgent {
  readonly id: string
  readonly reason: string
}

interface ReloadedAgents {
  readonly loaded: readonly string[]
  readonly skipped: readonly SkippedAgent[]
}

/** What the container's `agents` service is: `agents` never changes identity, so every reader that
 *  captured it at boot sees a reload. A run reads its profile once at its start and keeps it. */
interface LiveAgents {
  readonly agents: ReadonlyMap<string, AgentProfile>
  userIds(): ReadonlySet<AgentId>
  /** The whole next registry and its user ids in one assignment: no reader sees one without the other. */
  replace(next: ReadonlyMap<string, AgentProfile>, userIds: ReadonlySet<AgentId>): void
  /** Runs `task` after every earlier one has settled, so a slow disk read never lands over a newer one. */
  serialize<T>(task: () => Promise<T>): Promise<T>
}

interface LiveState {
  readonly agents: ReadonlyMap<string, AgentProfile>
  readonly userIds: ReadonlySet<AgentId>
}

function createLiveAgents(): LiveAgents {
  let state: LiveState = { agents: new Map(), userIds: new Set() }
  let tail: Promise<unknown> = Promise.resolve()
  const agents: ReadonlyMap<string, AgentProfile> = {
    get size() {
      return state.agents.size
    },
    get: (id) => state.agents.get(id),
    has: (id) => state.agents.has(id),
    forEach: (callback, thisArg) => {
      for (const [id, agent] of state.agents) {
        callback.call(thisArg, agent, id, agents)
      }
    },
    entries: () => state.agents.entries(),
    keys: () => state.agents.keys(),
    values: () => state.agents.values(),
    [Symbol.iterator]: () => state.agents[Symbol.iterator](),
  }

  return {
    agents,
    userIds: () => state.userIds,
    replace: (next, userIds) => {
      state = { agents: next, userIds }
    },
    serialize: (task) => {
      const result = tail.then(task)

      // Replaced, never chained onto: a failed task must not fail the next one.
      tail = result.catch(() => undefined)

      return result
    },
  }
}

/** Prologue: the log router is boot's, so boot hands it over for a reload to reach. */
export function createAgentLogsProvider(logs: Services['agentLogs']): ServiceProvider {
  return {
    name: 'agent-logs',
    register(bind): void {
      bind('agentLogs', () => logs)
    },
  }
}

// Step 12: add-only. A user agent whose id collides with a built-in or a plugin's is skipped rather
// than allowed to shadow it (buildUserAgents logs each skip). It hands the holder what it kept; the
// extension step that follows still sees a plain map.
export function createUserAgentsProvider(sources: readonly UserAgentSource[]): ServiceProvider {
  return {
    name: 'user-agents',
    register(bind, extend): void {
      bind('liveAgents', () => createLiveAgents())
      bind('userAgentIds', (app) => () => app.resolve('liveAgents').userIds())
      extend('agents', (current, app) => {
        const added = buildUserAgents(sources, {
          ctx: buildUserAgentContext(app),
          reserved: new Set(current.keys()),
          logger: app.resolve('logger'),
        })
        const kept = withoutInvalidTables(new Map([...current, ...added]), app)
        const userIds = new Set([...added.keys()].filter((id) => kept.has(id)).map(agentId))

        app.resolve('liveAgents').replace(kept, userIds)

        return kept
      })
    },
  }
}

// Step 14b: whatever the extension step produced is what a run reads, so the holder takes it over
// here, last, and every reader that captured `agents` sees later swaps.
export const liveAgentsProvider: ServiceProvider = {
  name: 'live-agents',
  register(_bind, extend): void {
    extend('agents', (current, app) => {
      const live = app.resolve('liveAgents')

      live.replace(current, live.userIds())

      return live.agents
    })
  },
}

/** The context user agents are built in: untrusted, but free to name a configured model tier. */
function buildUserAgentContext(app: App): AgentBuildContext {
  return {
    config: app.config,
    allToolNames: [...app.resolve('tools').keys()],
    trusted: false,
    allowModelTier: true,
  }
}

/** `[focus]` is a raw table to the engine; trading owns what it means, so an agent whose table it
 *  rejects is skipped here rather than failing a run later. Resolving `tradingServices` is
 *  cycle-free: `extend('agents')` already resolves `tools`, which resolves it. */
function withoutInvalidTables(
  agents: ReadonlyMap<string, AgentProfile>,
  app: App,
  onSkipped?: (skipped: SkippedAgent) => void
): Map<string, AgentProfile> {
  const logger = app.resolve('logger')
  const scope = app.resolve('tradingServices').focusScope
  const kept = new Map<string, AgentProfile>()

  for (const [id, agent] of agents) {
    const issues = agent.focus === undefined ? [] : validateAgentFocus(agent.focus, scope)

    if (issues.length > 0) {
      logger.warn('agents.focus_invalid', { id, issues })
      onSkipped?.({ id, reason: `focus ${issues.join('; ')}` })
      continue
    }

    kept.set(id, agent)
  }

  return kept
}

/** The full build of one agent, as boot builds it: schema, id, focus, budget cap, prompt scan and
 *  tier. Throws a `ConfigError` naming the first thing wrong. */
export function buildUserAgent(app: App, id: AgentId, toml: string): AgentProfile {
  assertAgentTomlMatchesSourceId(toml, id)

  const agent = loadAgentFromText(toml, id, buildUserAgentContext(app))
  const issues =
    agent.focus === undefined
      ? []
      : validateAgentFocus(agent.focus, app.resolve('tradingServices').focusScope)

  if (issues.length > 0) {
    throw new ConfigError(`agent '${id}' focus: ${issues.join('; ')}`)
  }

  return agent
}

/**
 * Reads `<data_dir>/agents/` again and swaps the registry in one step. The built-in, trading, plugin
 * and extension agents are kept as they are and are the only ids a file may not take: the previous
 * user ids are never reserved, or an agent could not be edited.
 */
export function reloadUserAgents(app: App): Promise<ReloadedAgents> {
  const live = app.resolve('liveAgents')

  return live.serialize(async () => {
    // A read that fails stops here, before `replace`: the running agents stay, and none of their
    // heartbeat rows are swept.
    const sources = await readSources(app)
    const skipped: SkippedAgent[] = []
    const owned = live.userIds()
    const kept = new Map([...live.agents].filter(([, agent]) => !owned.has(agent.id)))
    const added = buildUserAgents(sources, {
      ctx: buildUserAgentContext(app),
      reserved: new Set(kept.keys()),
      logger: app.resolve('logger'),
      onSkipped: (skip) => skipped.push(skip),
    })
    const next = withoutInvalidTables(new Map([...kept, ...added]), app, (skip) =>
      skipped.push(skip)
    )
    const loaded = [...added.keys()].filter((id) => next.has(id)).sort()

    live.replace(next, new Set(loaded.map(agentId)))
    await app.resolve('agentLogs').addAgentRoutes([...next.values()].map((agent) => agent.id))
    await syncHeartbeatAgents(app, [...next.values()])

    return { loaded, skipped }
  })
}

async function readSources(app: App): Promise<readonly UserAgentSource[]> {
  try {
    return await readUserAgents(userAgentsDir(app.config.paths.dataDir))
  } catch (err: unknown) {
    app.resolve('logger').warn('agents.reload_failed', { err: formatErrForLog(err) })

    throw err
  }
}

// The registry is already swapped, so a store that cannot be reached is logged, not thrown: the next
// reload or start syncs the same set again.
async function syncHeartbeatAgents(app: App, agents: readonly AgentProfile[]): Promise<void> {
  try {
    await app.resolve('heartbeatStore').syncAgents(agents.map((agent) => agent.id))
  } catch (err: unknown) {
    app.resolve('logger').warn('agents.sync_failed', { err: formatErrForLog(err) })
  }
}

import type { App, Bind, ServiceProvider } from '@/core/container'
import type { EventBus } from '@/core/events'
import type { Logger } from '@/core/logging/logger'
import type { ToolServices } from '@/core/tool'
import type { CliCommandDef } from '@/core/types/cli-command'
import type { CommandLane, OpenedSession, SessionQueue } from '@/core/types/session'
import type {
  AgentProfile,
  AgentRegistry,
  HookFn,
  Hooks,
  McpSessionLifecycle,
  ResearchCoordinator,
  RunIdentity,
  Runner,
} from '@/engine/api'
import type { ScopedJobStore } from '@/tools/api'
import { createTaskStatusBoard } from '@/app/task-status'
import { RunHalted } from '@/core/errors'
import {
  createAvailableDelegatesModifier,
  createAvailableSkillsModifier,
  createSessionPersistenceHooks,
  createUserPreferencesHooks,
  critical,
  RUN_LEASE_SLACK_MS,
  reminderModifier,
} from '@/engine/api'

interface HookOptions {
  /** False for a host that keeps no memory: no `prefs:*` read, no extra model call per run. */
  readonly learnsPreferences: boolean
}

const LEARNS_PREFERENCES: HookOptions = { learnsPreferences: true }

declare module '@/core/container' {
  interface Services {
    /** Contributed CLI command definitions. The CLI entry adapts and validates them after boot;
     *  built-ins never pass through here (`cli/registry.ts` stays static so preflight stays
     *  pre-boot). */
    cliCommands: readonly CliCommandDef[]
  }
}

// What a run needs from the composition root beyond its own module's services: the kernel handles,
// the session trail, and the tool handles. The daemon and the browser worker both compose from here;
// what only the daemon can do (scheduler deps, the scoped job store) stays in `services.ts`.

export interface KernelDeps {
  readonly logger: Logger
  readonly bus: EventBus
  readonly sessionQueue: SessionQueue
  readonly commandLane: CommandLane
  /** Frozen boot-computed process env allowlist handed to spawned shells. */
  readonly childEnvBase: Readonly<Record<string, string>>
}

/** Steps 0a-0c, and the task board every surface reports its passes on. The handles exist before the
 *  container does: boot needs the logger to report on the async loads that feed the providers, so
 *  they are constructed there and handed in. */
export function bindKernel(bind: Bind, kernel: KernelDeps): void {
  bind('logger', () => kernel.logger)
  bind('bus', () => kernel.bus)
  bind('sessionQueue', () => kernel.sessionQueue)
  bind('commandLane', () => kernel.commandLane)
  bind('childEnvBase', () => kernel.childEnvBase)
  bind('taskStatus', (app) => createTaskStatusBoard(app.config.locale.language))
}

// Step 8b: the empty base the trading and plugins providers extend. App owns it because no domain
// module may know the CLI exists, and the CLI cannot register providers.
export function createCliCommandsProvider(): ServiceProvider {
  return {
    name: 'cli-commands',
    register(bind): void {
      bind('cliCommands', () => [])
    },
  }
}

/**
 * The hooks the engine cannot build for itself: each one needs a handle from persistence, memory or
 * ai, and `engine` has an edge to none of them. Layered onto the engine's base set (loop detector,
 * capability gate, approval gate, trimming) rather than replacing it.
 *
 * Ordering that matters:
 *  - the session row is opened in `beforeRun`, before any message can be written against it;
 *  - the session trail is flushed in `afterRun` BEFORE `run_finished` is emitted, so a subscriber
 *    that reads the session back sees the turn that produced the event.
 *
 * The session hooks are `critical`: a failed claim would run a paid turn with no row behind it, and
 * a lost write would leave the next turn reasoning over history that was never persisted.
 */
export function extendHooks(
  current: Hooks,
  app: App,
  options: HookOptions = LEARNS_PREFERENCES
): Hooks {
  const session = createSessionPersistenceHooks(app.resolve('sessionStore'), app.resolve('bus'))
  const preferences = options.learnsPreferences
    ? createUserPreferencesHooks({ memory: app.resolve('memory') })
    : undefined

  return {
    ...current,
    beforeRun: [...current.beforeRun, critical(openSession(app))],
    // Volatile blocks append last: the date in reminderModifier changes daily, and prefix caches
    // reuse only the unchanged leading span of the system message.
    llmRequestModifiers: [
      ...current.llmRequestModifiers,
      createAvailableDelegatesModifier(app.resolve('agents')),
      createAvailableSkillsModifier(app.resolve('skillCatalog')),
      ...(preferences === undefined ? [] : [preferences.inject]),
      reminderModifier,
    ],
    afterTurn: [...current.afterTurn, critical(session.afterTurn)],
    beforeFinalize: [
      ...current.beforeFinalize,
      ...(preferences === undefined ? [] : [preferences.extract]),
    ],
    afterRun: [critical(session.afterRun), ...current.afterRun],
  }
}

// The session row is created here, not by the caller: every surface that starts a run would
// otherwise have to remember to, and a missing row loses the whole transcript. Ephemeral runs
// (delegated children) keep no row, so they never pollute a parent's transcript.
function openSession(app: App): HookFn {
  return async (run) => {
    if (run.env.persistence === 'ephemeral') {
      return
    }

    await claimSession(app, run.identity)
  }
}

export function createMcpSessionLifecycle(app: App): McpSessionLifecycle {
  return {
    open: (identity) => claimSession(app, identity),
    close: (identity, reason) =>
      app.resolve('sessionStore').finalizeRun(identity.sessionId, identity.runId, { reason }),
  }
}

async function claimSession(app: App, identity: RunIdentity): Promise<void> {
  const now = Date.now()
  const claimed = await app.resolve('sessionStore').claimRun({
    session: toOpenedSession(identity),
    runId: identity.runId,
    now,
    leaseExpiresBefore: now - (app.config.loop.maxDurationMs + RUN_LEASE_SLACK_MS),
  })

  if (!claimed) {
    throw new RunHalted('session_busy', `session ${identity.sessionId} is held by another run`)
  }
}

function toOpenedSession(identity: RunIdentity): OpenedSession {
  return {
    id: identity.sessionId,
    agentId: identity.agentId,
    userId: identity.userId,
    channel: identity.channel,
    ...(identity.chatId === undefined ? {} : { chatId: identity.chatId }),
  }
}

// What a run reads before it starts, bound here because only the composition root can see both the
// engine and the stores: the session's prior transcript and totals, and an agent's spend today.
export function bindRunReads(bind: Bind): void {
  bind(
    'sessionHistory',
    (app) => (sessionId, limit) => app.resolve('sessionStore').loadHistory(sessionId, limit)
  )
  bind('priorTotals', (app) => (sessionId) => app.resolve('sessionStore').loadTotals(sessionId))
  bind(
    'agentSpentToday',
    (app) => (id, nowMs) => app.resolve('llmAttemptStore').totalForBillingAgent(id, nowMs)
  )
}

// The handles a tool reaches through `ctx.services`. Assembled here because no single module can:
// `tools` declares the interfaces, `engine` and `persistence` hold the pieces, and only the composition
// root may see both. The scoped job store is the host's: only the daemon has a scheduler.
export function buildToolServices(app: App, jobs: ScopedJobStore): ToolServices {
  return {
    agents: toAgentRegistry(app.resolve('agents')),
    runner: lazyRunner(app),
    research: lazyResearchCoordinator(app),
    jobs,
    skillCatalog: app.resolve('skillCatalog'),
    fileRevisionGuard: app.resolve('fileRevisionGuard'),
    webRetrieval: app.resolve('webRetrieval'),
  }
}

// Resolved at call time, not at build time: `runner` needs the tool executor, the executor needs
// these services, and these services need the runner (delegate/delegate_parallel launch child
// runs). Deferring the lookup to the first delegation breaks the construction cycle without a
// second Runner instance: the container memoizes, so every call gets the same one the rest of the
// process uses.
function lazyRunner(app: App): Runner {
  return { run: (input, options) => app.resolve('runner').run(input, options) }
}

function lazyResearchCoordinator(app: App): ResearchCoordinator {
  return {
    run: (request, invocation) => app.resolve('researchCoordinator').run(request, invocation),
  }
}

/** The agent map, seen as the read-only registry every consumer of `AgentRegistry` expects. */
export function toAgentRegistry(agents: ReadonlyMap<string, AgentProfile>): AgentRegistry {
  return {
    get: (id) => agents.get(id) ?? null,
    all: () => [...agents.values()],
  }
}

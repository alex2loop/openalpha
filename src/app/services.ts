import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type {
  AcknowledgedRouter,
  AcknowledgedSendResult,
  ChannelRuntimeSnapshot,
  InboundInbox,
} from '@/channels/api'
import type { ChannelId } from '@/core/channels'
import type { App, ServiceProvider } from '@/core/container'
import type { EventBus } from '@/core/events'
import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { ToolServices } from '@/core/tool'
import type { OpenedSession, SessionQueue } from '@/core/types/session'
import type {
  AgentProfile,
  AgentRegistry,
  HookFn,
  Hooks,
  McpSessionLifecycle,
  ResearchCoordinator,
  RunIdentity,
  RunInput,
  Runner,
} from '@/engine/api'
import type {
  DeliverySink,
  DeliveryTarget,
  HeartbeatRunInput,
  Job,
  SchedulerTaskDeps,
} from '@/scheduler/api'
import type { TradingNotice } from '@/trading/api'
import { createScopedJobStore } from '@/app/scoped-jobs'
import { createSocialHeartbeatTasks } from '@/app/social'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { ChannelError, RunHalted } from '@/core/errors'
import { LOCAL_USER_ID, sessionId } from '@/core/ids'
import { hashString } from '@/core/utils/hash'
import {
  createAvailableDelegatesModifier,
  createAvailableSkillsModifier,
  createSessionPersistenceHooks,
  createUserPreferencesHooks,
  critical,
  RUN_LEASE_SLACK_MS,
  reminderModifier,
  WORKSPACES_DIR_NAME,
} from '@/engine/api'
import { t } from '@/i18n'
import { createChannelInbox } from '@/persistence/api'

// A job owns one stable session so consecutive fires continue one conversation. A shared heartbeat
// does the same (deterministic id); an isolated heartbeat gets a fresh id each run so it starts
// clean. See heartbeatRunInput.
const JOB_SESSION_PREFIX = 'job_'
const HEARTBEAT_SESSION_PREFIX = 'hb_'
// A scheduled run has no operator watching, so an unaddressed one has nowhere to prompt.
const UNATTENDED_CHANNEL = LOCAL_CHANNEL_ID
/** The chat id an unaddressed message carries to a surface, which has no chats of its own. */
const SURFACE_CHAT_ID = 'app'

declare module '@/core/container' {
  interface Services {
    logger: Logger
    bus: EventBus
    sessionQueue: SessionQueue
    inboundInbox: InboundInbox
    noticeSurfaces: NoticeSurfaces
    childEnvBase: Readonly<Record<string, string>>
  }
}

export interface KernelDeps {
  readonly logger: Logger
  readonly bus: EventBus
  readonly sessionQueue: SessionQueue
  /** Frozen boot-computed process env allowlist handed to spawned shells. */
  readonly childEnvBase: Readonly<Record<string, string>>
}

/** What a surface is handed: the text a chat would get, and the typed notice behind it where the
 *  sender was trading. A scheduled job's result carries text only. */
interface SurfaceMessage {
  readonly text: string
  readonly notice?: TradingNotice
}

/** A surface the daemon pushes to without a chat channel: an app, through the api server.
 *  It answers `unavailable` while nobody is listening, so a sender retries the way it would for an
 *  offline channel. It shows every message whatever chat id the target names. */
interface NoticeSurface {
  deliver(message: SurfaceMessage): AcknowledgedSendResult
}

/** The surfaces attached right now, by the channel id a notice is addressed to. */
interface NoticeSurfaces {
  attach(channel: ChannelId, surface: NoticeSurface): () => void
  find(channel: ChannelId): NoticeSurface | undefined
  /** The first attached surface's channel, for a notice no channel recipient can take. */
  first(): ChannelId | undefined
}

export interface DeliveryHub {
  /** Bound into the scheduler and anything else that delivers proactively. Never changes identity. */
  readonly sink: DeliverySink
  readonly surfaces: NoticeSurfaces
  /** Where an unaddressed notice goes. Undefined until channels attach, and again after detach. */
  defaultRecipient(): DeliveryTarget | undefined
  /** False in any process that runs no channels, where `snapshots()` proves nothing about liveness. */
  attached(): boolean
  /** Live channel lifecycle snapshots; empty while no daemon channels are attached. */
  snapshots(): readonly ChannelRuntimeSnapshot[]
  /** Delivers and reports whether the send actually completed. The delivery state machines in
   *  trading are only correct if `accepted` means the sender call finished — `sink.notify` is
   *  fire-and-forget by comparison. */
  sendAcknowledged(
    target: DeliveryTarget,
    message: SurfaceMessage,
    signal?: AbortSignal
  ): Promise<AcknowledgedSendResult>
  /** Called once the channels are up. Returns the disposer that detaches the router. */
  attach(options: {
    readonly notifier: AcknowledgedRouter
    readonly snapshots: () => readonly ChannelRuntimeSnapshot[]
    readonly recipient?: DeliveryTarget
  }): () => Promise<void>
}

// --- kernel -----------------------------------------------------------------

/**
 * Steps 0a-0c. These three exist before the container does: boot needs the logger to report on the
 * async loads that feed the providers, so they are constructed there and handed in here rather than
 * built by a factory the container calls back into.
 */
export function createKernelProvider(kernel: KernelDeps): ServiceProvider {
  return {
    name: 'kernel',
    register(bind): void {
      bind('logger', () => kernel.logger)
      bind('bus', () => kernel.bus)
      bind('sessionQueue', () => kernel.sessionQueue)
      bind('childEnvBase', () => kernel.childEnvBase)
      bind('inboundInbox', (app) =>
        createChannelInbox(app.resolve('storage'), app.resolve('dialect'))
      )
    },
  }
}

// --- delivery hub -----------------------------------------------------------

function createNoticeSurfaces(): NoticeSurfaces {
  const attached = new Map<ChannelId, NoticeSurface>()

  return {
    attach(channel, surface) {
      attached.set(channel, surface)

      return () => {
        if (attached.get(channel) === surface) {
          attached.delete(channel)
        }
      }
    },
    find: (channel) => attached.get(channel),
    first: () => attached.keys().next().value,
  }
}

/**
 * The seam between "who wants to deliver" and "who can". The scheduler binds its `DeliverySink` when
 * the container is assembled, but no adapter exists until the daemon starts the channels — so the
 * sink is a stable indirection whose backing router is attached later, and detached on shutdown.
 * Before attach (and after detach) a notice fails rather than queue forever: a cli process has no
 * channel to deliver to, and holding the notice would leak it. The rejection is what lets the
 * scheduler record a delivery error instead of finalizing a silently lost result.
 */
export function createDeliveryHub(): DeliveryHub {
  let notifier: AcknowledgedRouter | null = null
  let recipient: DeliveryTarget | undefined
  let readSnapshots: (() => readonly ChannelRuntimeSnapshot[]) | null = null

  // Read once per call: a detach racing the await would otherwise leave the second read null and
  // turn a completed send into a thrown "no channel attached".
  const capture = (): AcknowledgedRouter | null => notifier

  const surfaces = createNoticeSurfaces()

  return {
    surfaces,
    sink: {
      async notify(target: DeliveryTarget, text: string): Promise<void> {
        const router = capture()
        const surface = surfaces.find(target.channel)

        if (surface !== undefined) {
          if (surface.deliver({ text }) !== 'accepted') {
            throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
          }

          return
        }

        if (router === null) {
          throw new ChannelError('not_initialized', `no channel attached for ${target.channel}`)
        }

        if ((await router(target, text)) !== 'accepted') {
          throw new ChannelError('send_failed', `notification dropped for ${target.channel}`)
        }
      },
    },

    async sendAcknowledged(target, message, signal): Promise<AcknowledgedSendResult> {
      const router = capture()
      const surface = surfaces.find(target.channel)

      if (surface !== undefined) {
        return surface.deliver(message)
      }

      return router === null ? 'unavailable' : router(target, message.text, signal)
    },

    // A channel's own default chat first; with none attached, a surface that shows everything.
    defaultRecipient: () => {
      const channel = surfaces.first()

      return recipient ?? (channel === undefined ? undefined : { channel, chatId: SURFACE_CHAT_ID })
    },
    attached: () => readSnapshots !== null,
    snapshots: () => readSnapshots?.() ?? [],

    attach(options): () => Promise<void> {
      notifier = options.notifier
      recipient = options.recipient
      readSnapshots = options.snapshots

      return () => {
        // Both: a detached channel must not leave a stale address behind. The queues belong to the
        // channel runtimes, which dispose themselves — this hub owns no queue to drain.
        notifier = null
        recipient = undefined
        readSnapshots = null

        return Promise.resolve()
      }
    },
  }
}

// --- hooks ------------------------------------------------------------------

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
export function extendHooks(current: Hooks, app: App): Hooks {
  const session = createSessionPersistenceHooks(app.resolve('sessionStore'), app.resolve('bus'))
  const preferences = createUserPreferencesHooks({
    memory: app.resolve('memory'),
  })

  return {
    ...current,
    beforeRun: [...current.beforeRun, critical(openSession(app))],
    // Volatile blocks append last: the date in reminderModifier changes daily, and prefix caches
    // reuse only the unchanged leading span of the system message.
    llmRequestModifiers: [
      ...current.llmRequestModifiers,
      createAvailableDelegatesModifier(app.resolve('agents')),
      createAvailableSkillsModifier(app.resolve('skillCatalog')),
      preferences.inject,
      reminderModifier,
    ],
    afterTurn: [...current.afterTurn, critical(session.afterTurn)],
    beforeFinalize: [...current.beforeFinalize, preferences.extract],
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

// --- tool services ----------------------------------------------------------

// The handles a tool reaches through `ctx.services`. Assembled here because no single module can:
// `tools` declares the interfaces, `engine` and `persistence` hold the pieces, and only the composition
// root may see both.
export function buildToolServices(app: App): ToolServices {
  return {
    agents: toAgentRegistry(app.resolve('agents')),
    runner: lazyRunner(app),
    research: lazyResearchCoordinator(app),
    jobs: createScopedJobStore(app),
    skillCatalog: app.resolve('skillCatalog'),
    fileRevisionGuard: app.resolve('fileRevisionGuard'),
    webRetrieval: app.resolve('webRetrieval'),
  }
}

// Resolved at call time, not at build time: `runner` needs the tool executor, the executor needs
// these services, and these services need the runner (delegate/delegate_parallel launch child
// runs). Deferring
// the lookup to the first delegation breaks the construction cycle without a second Runner instance
// — the container memoizes, so every call gets the same one the rest of the process uses.
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

// --- scheduler deps ---------------------------------------------------------

export function buildSchedulerDeps(app: App, delivery: DeliveryHub): SchedulerTaskDeps {
  const agents = toAgentRegistry(app.resolve('agents'))

  return {
    jobStore: app.resolve('jobStore'),
    runner: app.resolve('runner'),
    occurrences: app.resolve('schedulerOccurrenceStore'),
    notifier: delivery.sink,
    logger: app.resolve('logger'),
    config: app.config,
    runInput: (job) => jobRunInput(job),
    renderAutoDisableNotice: (disabledJobId, consecutiveFailures) =>
      t(app.config.locale.language, 'channel.scheduleAutoDisabled', {
        id: disabledJobId,
        count: consecutiveFailures,
      }),
    defaultTarget: () => delivery.defaultRecipient(),
    failureTarget: () => app.config.schedule.failureTarget ?? delivery.defaultRecipient(),
    heartbeat: {
      agents,
      runner: app.resolve('runner'),
      store: app.resolve('heartbeatStore'),
      pauses: app.resolve('agentPauseStore'),
      runMaxDurationMs: app.config.loop.maxDurationMs,
      notifier: delivery.sink,
      logger: app.resolve('logger'),
      workspaceDir: (agent) => workspaceDirFor(app, agent.id),
      runInput: (input) => heartbeatRunInput(input),
      extraTasks: createSocialHeartbeatTasks(app, delivery),
    },
  }
}

function jobRunInput(job: Job): RunInput {
  return {
    agentId: job.agentId,
    sessionId: sessionId(`${JOB_SESSION_PREFIX}${job.id}`),
    userId: LOCAL_USER_ID,
    channel: job.target?.channel ?? UNATTENDED_CHANNEL,
    userMessage: job.prompt,
  }
}

function heartbeatRunInput(input: HeartbeatRunInput): RunInput {
  // Isolated heartbeats start a fresh transcript each run; shared heartbeats continue one stable
  // conversation. The shared id is hashed so it stays within the SessionId length limit even when
  // an AgentId is at its allowed maximum.
  const id =
    input.session === 'isolated'
      ? sessionId(randomUUID())
      : sessionId(`${HEARTBEAT_SESSION_PREFIX}${hashString(input.agent.id)}`)

  return {
    agentId: input.agent.id,
    sessionId: id,
    userId: LOCAL_USER_ID,
    channel: input.channel ?? UNATTENDED_CHANNEL,
    userMessage: input.prompt,
  }
}

// Mirrors the engine's own per-agent workspace so a heartbeat reads the HEARTBEAT.md the agent writes.
function workspaceDirFor(app: App, agent: AgentId): string {
  return join(app.config.paths.dataDir, WORKSPACES_DIR_NAME, agent)
}

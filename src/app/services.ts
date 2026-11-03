import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import type { DeliveryHub, NoticeSurfaces } from '@/app/delivery'
import type { KernelDeps } from '@/app/run-services'
import type { SelfUpgrade } from '@/app/update/install'
import type { InboundInbox } from '@/channels/api'
import type { App, ServiceProvider } from '@/core/container'
import type { EventBus } from '@/core/events'
import type { AgentId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { ToolServices } from '@/core/tool'
import type { CommandLane, SessionQueue } from '@/core/types/session'
import type { RunInput } from '@/engine/api'
import type { HeartbeatRunInput, Job, SchedulerTaskDeps } from '@/scheduler/api'
import { createAlertLiveCheck, createAlertRetirer } from '@/app/event-jobs'
import { runJobCommand } from '@/app/job-command'
import { toJobSessionId } from '@/app/job-session'
import { bindKernel, buildToolServices, toAgentRegistry } from '@/app/run-services'
import { createScopedJobStore } from '@/app/scoped-jobs'
import { createSocialHeartbeatTasks } from '@/app/social'
import { createTaskStatusBoard } from '@/app/task-status'
import { formatRunResultBody } from '@/channels/api'
import { LOCAL_CHANNEL_ID } from '@/core/channels'
import { LOCAL_USER_ID, sessionId } from '@/core/ids'
import { prepareAgentScratchDir } from '@/core/security/agent-directories'
import { hashString } from '@/core/utils/hash'
import { WORKSPACES_DIR_NAME } from '@/engine/api'
import { createUnrecordedSpendLog } from '@/engine/node-api'
import { t } from '@/i18n'
import { createChannelInbox } from '@/persistence/api'

// A job owns one stable session so consecutive fires continue one conversation. A shared heartbeat
// does the same (deterministic id); an isolated heartbeat gets a fresh id each run so it starts
// clean. See heartbeatRunInput.
const HEARTBEAT_SESSION_PREFIX = 'hb_'
// A scheduled run has no operator watching, so an unaddressed one has nowhere to prompt.
const UNATTENDED_CHANNEL = LOCAL_CHANNEL_ID

declare module '@/core/container' {
  interface Services {
    logger: Logger
    bus: EventBus
    sessionQueue: SessionQueue
    commandLane: CommandLane
    inboundInbox: InboundInbox
    noticeSurfaces: NoticeSurfaces
    deliveredNotices: DeliveryHub['onDelivered']
    selfUpgrade: SelfUpgrade
    childEnvBase: Readonly<Record<string, string>>
  }
}

// --- kernel -----------------------------------------------------------------

/**
 * Steps 0a-0c plus the host-bound services the engine names by interface only. The kernel handles
 * are built before the container does, so they are handed in; the daemon keeps the rest under its
 * data dir.
 */
export function createKernelProvider(kernel: KernelDeps): ServiceProvider {
  return {
    name: 'kernel',
    register(bind): void {
      bindKernel(bind, kernel)
      bind(
        'prepareWorkspace',
        (app) => (agentId) => prepareAgentScratchDir(app.config.paths.dataDir, agentId)
      )
      bind('unrecordedSpend', (app) =>
        createUnrecordedSpendLog(app.config.paths.dataDir, app.config.locale.timezone)
      )
      bind('taskStatus', (app) => createTaskStatusBoard(app.config.locale.language))
      bind('inboundInbox', (app) =>
        createChannelInbox(app.resolve('storage'), app.resolve('dialect'))
      )
    },
  }
}

// --- tool services ----------------------------------------------------------

export function buildDaemonToolServices(app: App): ToolServices {
  return buildToolServices(app, createScopedJobStore(app))
}

// --- scheduler deps ---------------------------------------------------------

export function buildSchedulerDeps(app: App, delivery: DeliveryHub): SchedulerTaskDeps {
  const agents = toAgentRegistry(app.resolve('agents'))

  return {
    jobStore: app.resolve('jobStore'),
    runner: app.resolve('runner'),
    occurrences: app.resolve('schedulerOccurrenceStore'),
    onTaskPass: app.resolve('taskStatus').listener,
    notifier: delivery.sink,
    logger: app.resolve('logger'),
    config: app.config,
    runInput: (job) => jobRunInput(job),
    runCommand: (job, run) => runJobCommand(app, { job, input: jobRunInput(job), run }),
    renderAutoDisableNotice: (disabledJobId, consecutiveFailures) =>
      t(app.config.locale.language, 'channel.scheduleAutoDisabled', {
        id: disabledJobId,
        count: consecutiveFailures,
      }),
    renderPartialNotice: (result) => formatRunResultBody(result, app.config.locale.language),
    defaultTarget: () => delivery.defaultRecipient(),
    failureTarget: () => app.config.schedule.failureTarget ?? delivery.defaultRecipient(),
    onEventJobRemoved: createAlertRetirer(app),
    isEventAlertLive: createAlertLiveCheck(app),
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
    sessionId: toJobSessionId(job.id),
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

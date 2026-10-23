import type { DeliveryHub } from '@/app/delivery'
import type { StartChannelsResult } from '@/channels/api'
import type {
  App,
  DaemonStartOptions,
  DaemonTask,
  DegradedItem,
  TaskPassListener,
} from '@/core/container'
import type { Logger } from '@/core/logging/logger'
import { resolveChannelDeps } from '@/app/channel-deps'
import { startChannelWatch } from '@/app/channel-watch'
import { startRetention } from '@/app/retention'
import { ApiTokenError } from '@/app/server/http/auth'
import { startSocialUpkeep } from '@/app/social-upkeep'
import { startUpdateWatch } from '@/app/update/watch'
import { startChannels } from '@/channels/api'
import { type AppError, ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { startScheduledWorkflows } from '@/engine/api'

type Disposer = () => void | Promise<void>

/** What the way down runs: `admission` closers first and synchronously, `disposers` after the drain. */
export interface Teardown {
  readonly admission: Array<() => void>
  readonly disposers: Disposer[]
}

export interface DaemonTaskState {
  failure?: AppError
}

interface StartDaemonSubsystemsOptions {
  readonly app: App
  readonly delivery: DeliveryHub
  readonly onHealth: DaemonStartOptions['onHealth']
  readonly startupSignal: AbortSignal
  readonly startup: AbortController
  readonly logger: Logger
  readonly tasks: Array<Promise<void>>
  readonly state: DaemonTaskState
  readonly teardown: Teardown
}

export async function startDaemonSubsystems(
  options: StartDaemonSubsystemsOptions
): Promise<readonly DegradedItem[]> {
  const { app, delivery, startupSignal, startup, logger, tasks, state, teardown } = options
  const { disposers } = teardown
  const { onHealth } = options
  const taskStatus = app.resolve('taskStatus')
  const onTaskPass = taskStatus.listener

  // The env is injected once here so no adapter reaches for process.env on its own.
  const channels = await startChannels(resolveChannelDeps(app, startupSignal, process.env))
  const tradingTasks = app.resolve('tradingServices').daemonTasks
  disposers.push(() => channels.stop())
  disposers.push(
    startScheduledWorkflows(
      {
        workflows: app.resolve('workflows'),
        logger,
        runner: app.resolve('runner'),
        config: app.config,
        onTaskPass,
      },
      startupSignal
    )
  )

  attachDelivery({ delivery, channels, disposers })
  // Before `channels.stop()` in the teardown (disposers run in push order, and the channels were
  // pushed first), so the loop cannot announce a channel that is only being closed.
  disposers.unshift(
    startChannelWatch({
      delivery,
      locale: app.config.locale.language,
      logger,
      onTaskPass,
      ...(onHealth === undefined ? {} : { onHealth }),
    })
  )

  // Named before any of them runs, so a task that waits long for its first pass still shows.
  taskStatus.track(taskNames(app, tradingTasks))

  // Started last of the delivering subsystems: a job that finishes before delivery is attached has
  // nowhere to send its answer, and a one-shot job is disabled on finalize so it never retries.
  trackDaemonTask({
    tasks,
    state,
    startup,
    name: 'scheduler',
    task: app.resolve('schedulerTask').start(startupSignal),
  })

  // After delivery is attached: an alert or brief that fires on the first tick must have a channel
  // to reach. Each task goes through the same tracker as the scheduler's, but a trading loop
  // quarantines its own failure first, so a bad tick stops that loop and not the daemon.
  for (const task of tradingTasks) {
    trackDaemonTask({ tasks, state, startup, name: task.name, task: task.start(startupSignal) })
  }

  disposers.push(...startMaintenance(app, logger, onTaskPass))

  attachPluginTasks({ app, signal: startupSignal, startup, tasks, state })

  const apiSkipped = app.config.api.enabled ? await startApi(app, teardown) : []

  return [...toChannelDegraded(channels.skipped), ...apiSkipped]
}

function toChannelDegraded(skipped: StartChannelsResult['skipped']): readonly DegradedItem[] {
  return skipped.map(
    ({ channel, error }): DegradedItem => ({
      kind: 'channel',
      subject: channel,
      message: error.operator,
    })
  )
}

/** Every daemon task the page lists, in the order it shows them. */
function taskNames(app: App, tradingTasks: readonly DaemonTask[]): readonly string[] {
  const hasScheduledWorkflow = [...app.resolve('workflows').values()].some(
    (workflow) => workflow.schedule !== undefined
  )
  const pluginTasks = app
    .resolve('plugins')
    .flatMap((plugin) => plugin.contributions.daemonTasks ?? [])

  return [
    ...tradingTasks.map((task) => task.name),
    'scheduler',
    'retention',
    'update',
    'social',
    'channels.watch',
    ...(hasScheduledWorkflow ? ['workflows'] : []),
    ...pluginTasks.map((task) => task.name),
  ]
}

function startMaintenance(app: App, logger: Logger, onTaskPass: TaskPassListener): Disposer[] {
  return [
    startRetention(app, logger, onTaskPass),
    startUpdateWatch(app, { logger, upgrade: app.resolve('selfUpgrade'), onTaskPass }),
    startSocialUpkeep(app, logger, onTaskPass),
  ]
}

// A token the operator named but cannot serve keeps the API closed; any other failure stops the start.
async function startApi(app: App, teardown: Teardown): Promise<readonly DegradedItem[]> {
  const logger = app.resolve('logger')

  try {
    const api = await app.resolve('apiStarter')(app, process.env)

    teardown.admission.push(api.closeAdmission)
    teardown.disposers.push(api.stop)
    logger.info('api.started', { port: app.config.api.port })

    return []
  } catch (err: unknown) {
    if (!(err instanceof ApiTokenError)) {
      throw err
    }

    logger.warn('api.token_unusable', { err: formatErrForLog(err) })

    return [{ kind: 'api', subject: 'api', message: err.operator }]
  }
}

interface AttachPluginTasksOptions {
  readonly app: App
  readonly signal: AbortSignal
  readonly startup: AbortController
  readonly tasks: Array<Promise<void>>
  readonly state: DaemonTaskState
}

function attachPluginTasks(options: AttachPluginTasksOptions): void {
  const { app, signal, startup, tasks, state } = options
  for (const plugin of app.resolve('plugins')) {
    for (const task of plugin.contributions.daemonTasks ?? []) {
      trackDaemonTask({ tasks, state, startup, name: task.name, task: task.start(signal) })
    }
  }
}

interface TrackDaemonTaskOptions {
  readonly tasks: Promise<void>[]
  readonly state: DaemonTaskState
  readonly startup: AbortController
  readonly name: string
  readonly task: Promise<void>
}

/** Only now does a proactive notice have anywhere to go. Detached first on the way down, so nothing
 *  is queued against an adapter that is already closing. */
function attachDelivery(options: {
  readonly delivery: DeliveryHub
  readonly channels: StartChannelsResult
  readonly disposers: Disposer[]
}): void {
  const { delivery, channels } = options

  if (channels.notifier === undefined) {
    return
  }

  options.disposers.unshift(
    delivery.attach({
      notifier: channels.notifier,
      snapshots: channels.snapshots,
      isWorking: channels.isWorking,
      recipients: channels.recipients,
      recipient: channels.defaultRecipient,
      isDeliverable: channels.isDeliverable,
    })
  )
}

export function trackDaemonTask(options: TrackDaemonTaskOptions): void {
  const { tasks, state, startup, name, task } = options
  tasks.push(
    task.catch((err: unknown) => {
      state.failure ??= new ConfigError(`daemon task failed: ${name}`, err)
      startup.abort(state.failure)
    })
  )
}

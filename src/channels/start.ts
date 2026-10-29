import type { BudgetCaps } from '@/channels/delivery/queue'
import type { ChannelRecipient } from '@/channels/recipient'
import type { ChannelDeliveryConfig, ChannelSettings } from '@/channels/schema'
import type {
  AcknowledgedSendOptions,
  AcknowledgedSendResult,
  ChannelAdapter,
  ChannelAdmission,
  ChannelDefinition,
  ChannelRuntime,
  ChannelRuntimeSnapshot,
  InboundInbox,
  OperatorNotices,
  OutboundTarget,
} from '@/channels/types'
import type { SlashDispatcher, SpendReader } from '@/commands/api'
import type { ChannelId } from '@/core/channels'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { EventBus } from '@/core/events'
import type { Logger } from '@/core/logging/logger'
import type {
  ChatBindingStore,
  CommandLane,
  PairingStore,
  PollOffsetStore,
  SessionActivity,
  SessionOpener,
  SessionQueue,
  SessionRouter,
} from '@/core/types/session'
import type { AgentRegistry, CostTracker, Runner, RunRegistry } from '@/engine/api'
import { createChannelRuntime } from '@/channels/lifecycle'
import { createChannelRecipient, resolveFallbackChat } from '@/channels/recipient'
import { resolveChannelSettings } from '@/channels/schema'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError, isAbortError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

export interface StartChannelsDeps {
  readonly definitions: readonly ChannelDefinition[]
  readonly config: ResolvedConfig
  readonly runner: Runner
  readonly runRegistry: RunRegistry
  readonly sessionQueue: SessionQueue
  readonly commandLane: CommandLane
  readonly costTracker: CostTracker
  readonly pairingStore: PairingStore
  readonly sessionRouter: SessionRouter
  readonly sessions: SessionOpener & SessionActivity
  readonly pollOffsets: PollOffsetStore
  readonly inbox: InboundInbox
  readonly bindings: ChatBindingStore
  readonly dispatcher: SlashDispatcher
  readonly spend: SpendReader
  readonly agents: AgentRegistry
  readonly operatorNotices: OperatorNotices
  readonly bus: EventBus
  readonly logger: Logger
  /** Injected so no adapter reads process.env directly. */
  readonly env: Record<string, string | undefined>
  /** Ends intake at shutdown: polling, the inbox drain and the admission of new work. Delivery does
   *  not stop with it; each runtime ends that itself in `stop`, after its final drain. */
  readonly intakeSignal: AbortSignal
}

/** Resolves the started runtime that owns the target's channel and submits through its queue.
 *  There is no started channel for that id gives `unavailable` rather than throwing: an
 *  unreachable recipient is a delivery outcome, not a programming error. */
export type AcknowledgedRouter = (
  target: OutboundTarget,
  text: string,
  options?: AcknowledgedSendOptions
) => Promise<AcknowledgedSendResult>

/** A channel left down because the operator can fix its credential (missing or rejected), with the
 *  reason worded for them. Such a channel never listens, so nobody is admitted through it. */
interface SkippedChannel {
  readonly channel: ChannelId
  readonly error: OperatorConfigError
}

export interface StartChannelsResult {
  stop(): Promise<void>
  snapshots(): readonly ChannelRuntimeSnapshot[]
  isWorking(): boolean
  readonly skipped: readonly SkippedChannel[]
  /** Routes an acknowledged send to whichever runtime owns its channel. Undefined if none started. */
  notifier?: AcknowledgedRouter
  /** Where an unaddressed proactive notice goes: the first started channel with a recipient. */
  defaultRecipient(): OutboundTarget | undefined
  /** Every started channel's own default chat, in start order: where one channel can reach the
   *  operator about another. */
  recipients(): ReadonlyMap<ChannelId, OutboundTarget>
  /** False for a channel that did not start or a chat whose pairing was revoked. */
  isDeliverable(target: OutboundTarget): Promise<boolean>
}

interface Started {
  readonly runtime: ChannelRuntime
  readonly adapter: ChannelAdapter
  readonly recipient: ChannelRecipient
}

export async function startChannels(deps: StartChannelsDeps): Promise<StartChannelsResult> {
  const built = await buildRuntimes(deps)
  const started: Started[] = []
  const skipped: SkippedChannel[] = []

  // Settled, not all: one channel with a stale token must not keep the others from coming up.
  const outcomes = await Promise.allSettled(built.map((entry) => entry.runtime.start()))

  for (const [index, outcome] of outcomes.entries()) {
    const entry = built[index]

    if (!entry) {
      continue
    }

    if (outcome.status === 'fulfilled') {
      started.push(entry)
      continue
    }

    const operatorError = await onStartFailed(deps, { entry, reason: outcome.reason })

    if (operatorError !== undefined) {
      skipped.push({ channel: entry.adapter.id, error: operatorError })
    }
  }

  if (started.length > 0) {
    deps.logger.info('channel.started', { channels: started.map((entry) => entry.adapter.id) })
  }

  await Promise.all(started.map((entry) => entry.recipient.refresh()))

  return buildResult(started, skipped, deps.logger)
}

async function buildRuntimes(deps: StartChannelsDeps): Promise<readonly Started[]> {
  const built: Started[] = []

  try {
    for (const definition of deps.definitions) {
      built.push(...createRuntime(deps, definition))
    }
  } catch (err: unknown) {
    await Promise.allSettled(built.map((entry) => entry.runtime.dispose()))
    throw err
  }

  return built
}

// A channel that fails to start is dropped and the daemon carries on. A failure the operator can fix
// (token missing or rejected) is returned for the start to report; anything else is logged only.
async function onStartFailed(
  deps: StartChannelsDeps,
  failure: { readonly entry: Started; readonly reason: unknown }
): Promise<OperatorConfigError | undefined> {
  const { entry, reason } = failure

  // The runtime never started; a dispose that throws must not strand the channels that did.
  await entry.runtime.dispose().catch((err: unknown) => {
    deps.logger.warn('channel.start_dispose_failed', {
      channel: entry.adapter.id,
      err: formatErrForLog(err),
    })
  })

  // A stop that arrived while the channel was starting ends the start; it is not a failure.
  if (isAbortError(reason)) {
    return undefined
  }

  if (reason instanceof OperatorConfigError) {
    deps.logger.warn('channel.start_skipped', {
      channel: entry.adapter.id,
      err: formatErrForLog(reason),
    })

    return reason
  }

  deps.logger.error('channel.start_failed', {
    channel: entry.adapter.id,
    err: formatErrForLog(reason),
  })

  return undefined
}

function createRuntime(deps: StartChannelsDeps, definition: ChannelDefinition): readonly Started[] {
  const config = definition.resolveConfig(deps.config.channels[definition.id])

  if (!definition.isEnabled(config)) {
    return []
  }

  const settings = resolveChannelSettings(config)

  assertConfiguredAgent(deps, definition, settings)

  const admission = definition.admission(config)
  const recipient = createRecipient(deps, definition, admission)
  const adapter = createAdapter(deps, definition, config)
  const runtime = createChannelRuntime({
    adapter,
    settings,
    allowedIds: admission.allowedIds,
    operatorUserIds: admission.operatorUserIds,
    mode: admission.mode,
    inbox: deps.inbox,
    inboxMaxAttempts: deps.config.inbox.maxAttempts,
    runMaxDurationMs: deps.config.loop.maxDurationMs,
    runner: deps.runner,
    runRegistry: deps.runRegistry,
    sessionQueue: deps.sessionQueue,
    commandLane: deps.commandLane,
    costTracker: deps.costTracker,
    caps: budgetCaps(deps.config),
    pairingStore: deps.pairingStore,
    onPaired: (chatId) => recipient.admitted(chatId),
    sessionRouter: deps.sessionRouter,
    sessions: deps.sessions,
    bindings: deps.bindings,
    dispatcher: deps.dispatcher,
    spend: deps.spend,
    agents: deps.agents,
    operatorNotices: deps.operatorNotices,
    bus: deps.bus,
    logger: deps.logger,
    locale: deps.config.locale.language,
    intakeSignal: deps.intakeSignal,
  })

  return [{ runtime, adapter, recipient }]
}

function createAdapter(
  deps: StartChannelsDeps,
  definition: ChannelDefinition,
  config: ChannelDeliveryConfig
): ChannelAdapter {
  return definition.create(config, {
    logger: deps.logger,
    pollOffsets: deps.pollOffsets,
    inbox: deps.inbox,
    env: deps.env,
    dataDir: deps.config.paths.dataDir,
  })
}

function createRecipient(
  deps: StartChannelsDeps,
  definition: ChannelDefinition,
  admission: ChannelAdmission
): ChannelRecipient {
  const configured = resolveFallbackChat(definition, deps.config.channels[definition.id])

  return createChannelRecipient({
    channel: definition.id,
    ...(configured === undefined ? {} : { configured }),
    ...(admission.mode === 'pairing' ? { store: deps.pairingStore } : {}),
    logger: deps.logger,
  })
}

function assertConfiguredAgent(
  deps: StartChannelsDeps,
  definition: ChannelDefinition,
  settings: ChannelSettings
): void {
  const agent = settings.agent

  if (agent !== undefined && deps.agents.get(agent) === null) {
    throw new ConfigError(`channel ${definition.id}: configured agent '${agent}' not found`)
  }
}

function budgetCaps(config: ResolvedConfig): BudgetCaps {
  return {
    maxDailyUsd: config.budget.maxDailyUsd,
    maxMonthlyUsd: config.budget.maxMonthlyUsd,
  }
}

function toRecipients(started: readonly Started[]): ReadonlyMap<ChannelId, OutboundTarget> {
  return new Map(
    started.flatMap((entry): [ChannelId, OutboundTarget][] => {
      const chatId = entry.recipient.current()

      return chatId === undefined ? [] : [[entry.adapter.id, { channel: entry.adapter.id, chatId }]]
    })
  )
}

function buildResult(
  started: readonly Started[],
  skipped: readonly SkippedChannel[],
  logger: Logger
): StartChannelsResult {
  const byChannel = new Map<ChannelId, Started>(started.map((entry) => [entry.adapter.id, entry]))

  const base: StartChannelsResult = {
    async stop(): Promise<void> {
      await Promise.allSettled(started.map((entry) => entry.runtime.dispose()))
    },
    snapshots: () => started.map((entry) => entry.runtime.snapshot()),
    recipients: () => toRecipients(started),
    defaultRecipient: () => toRecipients(started).values().next().value,
    isWorking: () => started.some((entry) => entry.runtime.isWorking()),
    isDeliverable: async (target) =>
      (await byChannel.get(target.channel)?.recipient.isDeliverable(target.chatId)) ?? false,
    skipped,
  }

  // No channel came up: the caller binds a no-op sink rather than crashing a CLI-only install.
  if (byChannel.size === 0) {
    return base
  }

  const notifier: AcknowledgedRouter = async (target, text, options) => {
    const entry = byChannel.get(target.channel)

    if (entry === undefined) {
      return 'unavailable'
    }

    let deliverable: boolean

    // An unreadable pairing is not a revoked one: the send waits on the retry ladder instead of
    // switching the alert or brief off.
    try {
      deliverable = await entry.recipient.isDeliverable(target.chatId)
    } catch (err: unknown) {
      logger.warn('channel.paired_check_failed', {
        channel: target.channel,
        err: formatErrForLog(err),
      })

      return 'unavailable'
    }

    if (!deliverable) {
      await entry.recipient.refresh()

      return 'revoked'
    }

    return entry.runtime.notify(target, text, options)
  }

  return {
    ...base,
    notifier,
  }
}

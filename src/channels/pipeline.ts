import type { Gate } from '@/channels/delivery/gate'
import type { InboundHandler } from '@/channels/delivery/inbound'
import type { Notifier as NotifierType } from '@/channels/delivery/outbound/notifier'
import type { ProactiveSubscription } from '@/channels/delivery/outbound/proactive'
import type { ChannelPlanReviewer } from '@/channels/delivery/plan-review'
import type { BudgetCaps, InboundQueue } from '@/channels/delivery/queue'
import type { SentMessages } from '@/channels/delivery/sent-messages'
import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { OperatorContext } from '@/channels/operator'
import type { ChannelSettings } from '@/channels/schema'
import type {
  AdmissionMode,
  ChannelAdapter,
  InboundInbox,
  OperatorNotices,
  OutboundButton,
} from '@/channels/types'
import type { SlashDispatcher, SpendReader } from '@/commands/api'
import type { EventBus } from '@/core/events'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  ChatBindingStore,
  CommandLane,
  PairingStore,
  SessionActivity,
  SessionOpener,
  SessionQueue,
  SessionRouter,
} from '@/core/types/session'
import type { AgentRegistry, CostTracker, Runner, RunRegistry } from '@/engine/api'
import { type ActiveSlashRuns, createActiveSlashRuns } from '@/channels/delivery/active-runs'
import { dispatchCallbackQuery } from '@/channels/delivery/callbacks'
import { createTextChoices, type TextChoices } from '@/channels/delivery/choices'
import { createGate } from '@/channels/delivery/gate'
import { createInboundHandler } from '@/channels/delivery/inbound'
import {
  type OrchestratorDeps,
  redeliverAnswer,
  runExchange,
} from '@/channels/delivery/orchestrator'
import {
  resolveOutboundMarkup,
  selectRenderer,
  sendChunked,
} from '@/channels/delivery/outbound/chunked-send'
import { Notifier } from '@/channels/delivery/outbound/notifier'
import { subscribeProactive } from '@/channels/delivery/outbound/proactive'
import { createChannelPlanReviewer } from '@/channels/delivery/plan-review'
import { createInboundQueue } from '@/channels/delivery/queue'
import { createSentMessages } from '@/channels/delivery/sent-messages'
import { ChannelError } from '@/core/errors'
import { observe } from '@/core/events'
import { formatErrForLog } from '@/core/security/credentials'
import { pluralKey, t, translateLlmErrorCode } from '@/i18n'

export interface ChannelRuntimeDeps {
  readonly adapter: ChannelAdapter
  readonly settings: ChannelSettings
  readonly allowedIds: readonly string[]
  readonly operatorUserIds: readonly string[]
  readonly mode: AdmissionMode
  readonly inbox: InboundInbox
  readonly inboxMaxAttempts: number
  readonly runMaxDurationMs: number
  readonly runner: Runner
  readonly runRegistry: RunRegistry
  readonly sessionQueue: SessionQueue
  readonly commandLane: CommandLane
  readonly costTracker: CostTracker
  readonly caps: BudgetCaps
  readonly pairingStore: PairingStore
  readonly onPaired: (chatId: string) => Promise<void>
  readonly sessionRouter: SessionRouter
  readonly sessions: SessionOpener & SessionActivity
  readonly bindings: ChatBindingStore
  readonly dispatcher: SlashDispatcher
  readonly spend: SpendReader
  readonly agents: AgentRegistry
  readonly operatorNotices: OperatorNotices
  readonly bus: EventBus
  readonly logger: Logger
  readonly locale: Locale
  /** Aborts at the daemon's shutdown: stops polling, the inbox drain and the admission of new work. */
  readonly intakeSignal: AbortSignal
}

/** The runtime's own outbound signal lives past `intakeSignal`, so the notices and answers still
 *  queued at shutdown get their bounded final attempt before it aborts in `dispose`. */
export interface PipelineDeps extends ChannelRuntimeDeps {
  readonly outboundSignal: AbortSignal
}

export interface Pipeline {
  readonly notifier: NotifierType
  readonly queue: InboundQueue
  readonly proactive: ProactiveSubscription
  readonly planReviewer: ChannelPlanReviewer
  readonly handler: InboundHandler
  readonly gate: Gate
  readonly sent: SentMessages
  readonly isWorking: () => boolean
}

interface NotifierSend {
  readonly notifier: NotifierType
  readonly sendText: (
    chatId: string,
    text: string,
    buttons?: readonly OutboundButton[]
  ) => Promise<void>
}

function createNotifier(deps: PipelineDeps): NotifierSend {
  const { adapter, logger, settings, outboundSignal } = deps
  const notifier = new Notifier({
    logger,
    sender: (out, options) => adapter.send(out, options),
    maxPerMinute: settings.notifyMaxPerMinute,
    queueMax: settings.notifyQueueMax,
    maxAttempts: settings.notifyMaxAttempts,
    drainTimeoutMs: settings.notifyDrainTimeoutMs,
    signal: outboundSignal,
  })

  // A dropped notice is a failed send, not a silent one: the caller decides what to undo.
  const sendText = async (chatId: string, text: string): Promise<void> => {
    const { outcome } = await sendChunked(
      { notifier, adapter, settings },
      { target: { channel: adapter.id, chatId }, text, markup: false }
    )

    if (outcome === 'dropped') {
      throw new ChannelError('send_failed', `notification dropped for ${adapter.id}`)
    }
  }

  return { notifier, sendText }
}

/** An answer to the operator's own message goes straight out, as an agent reply does. The
 *  notifier's per-minute window meters unsolicited notices; a reply held behind it lands a minute
 *  late, under whatever the operator asked next. */
function createReplySender(
  deps: PipelineDeps
): (chatId: string, text: string, buttons?: readonly OutboundButton[]) => Promise<void> {
  const { adapter, settings, outboundSignal } = deps
  const useMarkup = resolveOutboundMarkup(adapter, settings, true)

  return async (chatId, text, buttons) => {
    const chunks = selectRenderer(adapter, useMarkup).chunk(text, adapter.capabilities.maxTextLen)

    for (const [index, chunk] of chunks.entries()) {
      // The keyboard rides the last chunk only: repeated under every chunk of a split message, it
      // hands the reader the same three buttons three times.
      const last = index === chunks.length - 1

      await adapter.send(
        {
          channel: adapter.id,
          chatId,
          text: chunk,
          ...(useMarkup ? { useMarkup: true as const } : {}),
          ...(last && buttons !== undefined && buttons.length > 0 ? { buttons } : {}),
        },
        { signal: outboundSignal }
      )
    }
  }
}

function createOperatorSurfaces(
  deps: PipelineDeps,
  surfaces: { readonly gate: Gate; readonly choices: TextChoices }
): Pick<Pipeline, 'proactive' | 'planReviewer'> {
  const { gate, choices } = surfaces
  const { adapter, logger, locale, outboundSignal } = deps
  const isOperatorUser = (userId: string | undefined, context: OperatorContext): boolean =>
    gate.isOperatorUser(userId, context)

  return {
    proactive: subscribeProactive({
      bus: deps.bus,
      logger,
      adapter,
      channelId: adapter.id,
      locale,
      signal: outboundSignal,
      choices,
      isOperatorUser,
    }),
    planReviewer: createChannelPlanReviewer({
      adapter,
      channelId: adapter.id,
      locale,
      logger,
      signal: outboundSignal,
      choices,
      isOperatorUser,
    }),
  }
}

export function createPipeline(deps: PipelineDeps): Pipeline {
  const { adapter, logger, locale, settings, intakeSignal } = deps
  const { notifier, sendText } = createNotifier(deps)
  const sendReply = createReplySender(deps)
  const sent = createSentMessages()
  const queue = createInboundQueue({
    costTracker: deps.costTracker,
    sessionQueue: deps.sessionQueue,
    notify: sendText,
    settings,
    caps: deps.caps,
    logger,
    locale,
    signal: intakeSignal,
  })

  const gate = createGate({
    store: deps.pairingStore,
    onPaired: deps.onPaired,
    router: deps.sessionRouter,
    channel: adapter.id,
    configIds: deps.allowedIds,
    operatorUserIds: deps.operatorUserIds,
    mode: deps.mode,
    sendText: sendReply,
    bus: deps.bus,
    logger,
    locale,
  })

  const choices = createTextChoices(locale)
  const { proactive, planReviewer } = createOperatorSurfaces(deps, { gate, choices })
  const slashRuns = createActiveSlashRuns()
  const handler = createInboundHandler(
    handlerDeps(deps, {
      gate,
      queue,
      choices,
      proactive,
      planReviewer,
      slashRuns,
      sent,
      sendText: sendReply,
    })
  )

  subscribeNotices(deps, sendText)

  const { isWorking } = slashRuns

  return { notifier, queue, proactive, planReviewer, handler, gate, sent, isWorking }
}

// Two things the agent does that the operator would otherwise never see: a question it is blocked
// on, and a silent reroute to another provider. Both are notices, never replies — a failed send is
// logged and dropped rather than retried into a chat that may be the reason it failed.
function subscribeNotices(
  deps: PipelineDeps,
  sendText: (chatId: string, text: string, buttons?: readonly OutboundButton[]) => Promise<void>
): void {
  const { bus, locale, logger, outboundSignal: signal } = deps
  const notice: Notice = { sendText, logger }

  observe(bus, 'clarification_requested', {
    signal,
    fn: (event) => {
      // One bus serves every surface: a question raised on another channel is not ours to relay.
      if (event.channel !== deps.adapter.id || event.chatId === undefined) {
        return
      }

      notify(notice, event.chatId, t(locale, 'channel.clarification', { question: event.question }))
    },
  })

  observe(bus, 'provider_fallback', {
    signal,
    fn: (event) => {
      if (event.channel !== deps.adapter.id || event.chatId === undefined) {
        return
      }

      const text = t(locale, 'ui.providerFallback', {
        from: event.from,
        to: event.to,
        reason: translateLlmErrorCode(locale, event.reason),
      })

      notify(notice, event.chatId, text)
    },
  })

  subscribeRecoveryNotices(deps, notice)
}

// Recovery notices: a restarted answer supersedes the partial the operator already saw, and
// dropped steering means their message needs a resend - both are surface-state facts only the
// engine knows.
function subscribeRecoveryNotices(deps: PipelineDeps, notice: Notice): void {
  const { bus, locale, outboundSignal: signal } = deps

  observe(bus, 'turn_restarted', {
    signal,
    fn: (event) => {
      if (event.channel !== deps.adapter.id || event.chatId === undefined) {
        return
      }

      const text = t(locale, 'channel.turnRestarted', {
        reason: translateLlmErrorCode(locale, event.code),
      })

      notify(notice, event.chatId, text)
    },
  })

  observe(bus, 'steering_dropped', {
    signal,
    fn: (event) => {
      if (event.channel !== deps.adapter.id || event.chatId === undefined) {
        return
      }

      notify(
        notice,
        event.chatId,
        t(locale, pluralKey(event.count, 'channel.steeringDroppedOne', 'channel.steeringDropped'), {
          count: event.count,
        })
      )
    },
  })
}

interface Notice {
  readonly sendText: (
    chatId: string,
    text: string,
    buttons?: readonly OutboundButton[]
  ) => Promise<void>
  readonly logger: Logger
}

function notify(notice: Notice, chatId: string, text: string): void {
  notice.sendText(chatId, text).catch((err: unknown) => {
    notice.logger.warn('channel.notice_failed', { err: formatErrForLog(err) })
  })
}

interface HandlerParts {
  readonly gate: Gate
  readonly queue: InboundQueue
  readonly choices: TextChoices
  readonly proactive: ProactiveSubscription
  readonly planReviewer: ChannelPlanReviewer
  readonly slashRuns: ActiveSlashRuns
  readonly sent: SentMessages
  readonly sendText: (
    chatId: string,
    text: string,
    buttons?: readonly OutboundButton[]
  ) => Promise<void>
}

function orchestratorDeps(deps: PipelineDeps, parts: HandlerParts): OrchestratorDeps {
  return {
    adapter: deps.adapter,
    runner: deps.runner,
    bus: deps.bus,
    settings: deps.settings,
    locale: deps.locale,
    logger: deps.logger,
    signal: deps.outboundSignal,
    intakeSignal: deps.intakeSignal,
    sent: parts.sent,
    sessions: deps.sessions,
    reviewPlan: (chatId, input) => parts.planReviewer.reviewPlan(chatId, input),
  }
}

function handlerDeps(deps: PipelineDeps, parts: HandlerParts): InboundHandlerDeps {
  const { adapter, logger, locale, settings } = deps
  const orchestrator = orchestratorDeps(deps, parts)

  return {
    channelId: adapter.id,
    gate: parts.gate,
    queue: parts.queue,
    choices: parts.choices,
    sessionQueue: deps.sessionQueue,
    commandLane: deps.commandLane,
    sessions: deps.sessions,
    dispatcher: deps.dispatcher,
    spend: deps.spend,
    adapter,
    runRegistry: deps.runRegistry,
    slashRuns: parts.slashRuns,
    bindings: deps.bindings,
    agents: deps.agents,
    operatorNotices: deps.operatorNotices,
    bus: deps.bus,
    settings,
    signal: deps.intakeSignal,
    runExchange: (exchange) => runExchange(orchestrator, exchange),
    redeliver: (answer) => redeliverAnswer(orchestrator, answer),
    sendText: parts.sendText,
    onCallback: (query) =>
      dispatchCallbackQuery(
        {
          adapter,
          runRegistry: deps.runRegistry,
          slashRuns: parts.slashRuns,
          logger,
          locale,
          resolveApproval: parts.proactive.resolveApproval,
          resolvePlanDecision: parts.planReviewer.resolveDecision,
        },
        query
      ),
    logger,
    locale,
  }
}

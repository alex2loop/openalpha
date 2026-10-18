import type { FinalAnswer } from '@/channels/delivery/answer'
import type { Reply } from '@/channels/delivery/reply'
import type { SentMessages } from '@/channels/delivery/sent-messages'
import type { ChannelSettings } from '@/channels/schema'
import type { ChannelAdapter, InboundMessage, SentRef } from '@/channels/types'
import type { EventBus } from '@/core/events'
import type { AgentId, SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SessionActivity } from '@/core/types/session'
import type { ResearchPlanDecision, ResearchPlanReview, Runner, RunResult } from '@/engine/api'
import { AnswerUndelivered } from '@/channels/delivery/answer'
import { buildAbortCallbackData } from '@/channels/delivery/callbacks'
import {
  buildFooterChunks,
  formatChannelFooter,
  formatPlanBlock,
  formatRunResultBody,
} from '@/channels/delivery/format'
import { resolveGapNote } from '@/channels/delivery/gap-note'
import { resolveOutboundMarkup, selectRenderer } from '@/channels/delivery/outbound/chunked-send'
import { createReply } from '@/channels/delivery/reply'
import { toReplyLead } from '@/channels/delivery/reply-context'
import { type ChunkStream, createChunkStream } from '@/channels/delivery/stream'
import { AppError, ChannelError, RunHalted } from '@/core/errors'
import { observe } from '@/core/events'
import { LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const LEAD_SEPARATOR = '\n\n'

export interface OrchestratorDeps {
  readonly adapter: ChannelAdapter
  readonly runner: Runner
  readonly bus: EventBus
  readonly settings: ChannelSettings
  readonly locale: Locale
  readonly logger: Logger
  readonly signal: AbortSignal
  readonly sent: SentMessages
  readonly sessions: SessionActivity
  /** Channel-owned deep-plan review; the prompted chat supplies the explicit start or cancel. */
  readonly reviewPlan: (chatId: string, input: ResearchPlanReview) => Promise<ResearchPlanDecision>
}

interface ReplyTarget {
  readonly chatId: string
  readonly messageId: string
  readonly reactionRef?: string
}

export interface Exchange {
  readonly combined: InboundMessage
  readonly sessionId: SessionId
  readonly agentId: AgentId
}

export async function runExchange(deps: OrchestratorDeps, exchange: Exchange): Promise<void> {
  const { adapter, settings, locale } = deps
  const { combined, sessionId, agentId } = exchange
  const useMarkup = resolveOutboundMarkup(adapter, settings, true)
  const reply = await openReply(deps, exchange)
  const stream = createChunkStream({
    adapter,
    reply,
    settings,
    useMarkup,
    logger: deps.logger,
    signal: deps.signal,
    locale,
    reviewPlan: (input) => deps.reviewPlan(combined.chatId, input),
  })
  const startedAt = performance.now()
  const prompts = watchApprovalPrompts(deps, combined)
  let result: RunResult

  // Inside the try: `typing` arms a repeating ping that only settleExchange clears.
  // The run identity is the single local operator, never the platform sender: an admitted chat
  // speaks *for* the operator, so branding the sender id here would fork the ledger per account.
  try {
    reply.typing(true)
    await reply.react('👀')

    const lead = await composeLead(deps, exchange)

    result = await deps.runner.run(
      {
        agentId,
        sessionId,
        userId: LOCAL_USER_ID,
        channel: combined.channel,
        userMessage: combined.text,
        ...(lead === undefined ? {} : { lead }),
        onChunk: (event) => stream.onChunk(event),
      },
      {
        chatId: combined.chatId,
        parentSignal: deps.signal,
        researchInteraction: stream.researchInteraction,
      }
    )
  } catch (err: unknown) {
    await settleExchange(deps, { reply, stream, prompted: prompts.prompted() })
    await reportRunnerFailure(deps, { reply, afterApproval: prompts.prompted() }, err)
    throw toRunnerError(err)
  } finally {
    prompts.stop()
  }

  await settleExchange(deps, { reply, stream, prompted: prompts.prompted() })

  await deliverResult(deps, {
    reply,
    stream,
    combined,
    result,
    useMarkup,
    afterApproval: prompts.prompted(),
    elapsedMs: performance.now() - startedAt,
  })
}

// Batched messages arrive here as one: one lead per run, and a burst keeps only its last reply.
async function composeLead(
  deps: OrchestratorDeps,
  exchange: Exchange
): Promise<string | undefined> {
  const gapNote = await resolveGapNote({
    sessionId: exchange.sessionId,
    sessions: deps.sessions,
    gapNoteMs: deps.settings.gapNoteMs,
    locale: deps.locale,
    logger: deps.logger,
  })
  const replyLead = toReplyLead({
    message: exchange.combined,
    sent: deps.sent,
    locale: deps.locale,
  })
  const parts = [gapNote, replyLead].filter((part) => part !== undefined)

  return parts.length === 0 ? undefined : parts.join(LEAD_SEPARATOR)
}

interface ApprovalPromptWatch {
  /** True once this chat was asked to approve something during the run. */
  prompted(): boolean
  stop(): void
}

// The prompt is a message of its own, sent below the placeholder while the run waits. Knowing one
// landed is what keeps the answer from being edited in above it.
function watchApprovalPrompts(
  deps: OrchestratorDeps,
  combined: InboundMessage
): ApprovalPromptWatch {
  const controller = new AbortController()
  let prompted = false

  observe(deps.bus, 'approval_requested', {
    signal: controller.signal,
    fn: (event) => {
      if (event.channel === combined.channel && event.chatId === combined.chatId) {
        prompted = true
      }
    },
  })

  return {
    prompted: () => prompted,
    stop: () => controller.abort(),
  }
}

// A refused placeholder would leave the turn burning budget on an answer with nowhere to land.
// Throwing hands the message to the inbox retry/dead-letter path instead of completing it
// silently — a transient send failure is indistinguishable from a permanent one.
async function openReply(deps: OrchestratorDeps, exchange: Exchange): Promise<Reply> {
  const { adapter, locale } = deps
  const { combined, sessionId } = exchange
  const reply = newReply(deps, combined)
  const cancelData = adapter.capabilities.inlineButtons
    ? buildAbortCallbackData(sessionId)
    : undefined
  const opened = await reply.open(
    t(locale, 'ui.working'),
    cancelData === undefined ? undefined : { cancelData }
  )

  if (!opened) {
    throw new ChannelError('send_failed', 'channel refused the opening placeholder')
  }

  return reply
}

function newReply(deps: OrchestratorDeps, target: ReplyTarget): Reply {
  return createReply({
    adapter: deps.adapter,
    logger: deps.logger,
    chatId: target.chatId,
    inboundMessageId: target.messageId,
    ...(target.reactionRef !== undefined ? { inboundReactionRef: target.reactionRef } : {}),
    useReactions: deps.settings.useReactions,
    typingEnabled: deps.settings.typingIndicator,
    locale: deps.locale,
  })
}

async function reportRunnerFailure(
  deps: OrchestratorDeps,
  target: { readonly reply: Reply; readonly afterApproval: boolean },
  err: unknown
): Promise<void> {
  const { reply } = target
  const text = t(deps.locale, 'errors.unexpected')

  deps.logger.error('orchestrator.run_failed', {
    channel: deps.adapter.id,
    err: formatErrForLog(err),
  })

  // Same ordering rule as the answer: a prompt sits below the placeholder, so editing it would
  // report the failure above the approval that preceded it.
  await runNonMasking(deps, 'orchestrator.failure_update_failed', async () => {
    if (target.afterApproval) {
      await reply.overflow(text, { signal: deps.signal })
    } else {
      await reply.update(text, { retryOn429: true, signal: deps.signal })
    }
  })
  await runNonMasking(deps, 'orchestrator.failure_reaction_failed', () => reply.react('❌'))
}

interface SettleInput {
  readonly reply: Reply
  readonly stream: ChunkStream
  /** The answer will go below the approval prompt, so the preview stays and must lose its button. */
  readonly prompted: boolean
}

async function settleExchange(deps: OrchestratorDeps, input: SettleInput): Promise<void> {
  const { reply, stream } = input

  // Settle drains accepted research milestones and the in-flight edit before the final answer,
  // then stops the stream; a separate stop first would discard accepted milestones.
  await runNonMasking(deps, 'orchestrator.stream_settle_failed', () => stream.settle())
  await runNonMasking(deps, 'orchestrator.typing_stop_failed', () => reply.typing(false))

  if (input.prompted) {
    await runNonMasking(deps, 'orchestrator.disarm_failed', () => reply.disarm())
  }
}

async function runNonMasking(
  deps: OrchestratorDeps,
  event: string,
  task: () => void | Promise<void>
): Promise<void> {
  try {
    await task()
  } catch (err: unknown) {
    deps.logger.warn(event, { channel: deps.adapter.id, err: formatErrForLog(err) })
  }
}

function toRunnerError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }

  return new RunHalted('llm_error', 'channel exchange runner failed')
}

interface Delivery {
  readonly reply: Reply
  /** Read for the plan block its preview showed, which this write edits away, and the last turn's
   *  metric: the model actually reached and the context it filled, as the CLI reports. */
  readonly stream: ChunkStream
  readonly combined: InboundMessage
  readonly result: RunResult
  readonly useMarkup: boolean
  /** An approval prompt was sent below the placeholder, so the answer must not be edited into it. */
  readonly afterApproval: boolean
  /** Wall time of the whole exchange, measured with performance.now(). */
  readonly elapsedMs: number
}

interface AnswerSend {
  readonly reply: Reply
  readonly answer: FinalAnswer
  readonly useMarkup: boolean
  readonly afterApproval: boolean
}

// The run is spent by now. A failed final write carries the answer out so the inbox retry sends it
// again rather than running the agent a second time.
async function deliverResult(deps: OrchestratorDeps, delivery: Delivery): Promise<void> {
  const answer = toFinalAnswer(deps.locale, delivery)

  try {
    await sendAnswer(deps, {
      reply: delivery.reply,
      answer,
      useMarkup: delivery.useMarkup,
      afterApproval: delivery.afterApproval,
    })
  } catch (err: unknown) {
    throw new AnswerUndelivered(answer, err)
  }
}

// Sends the final message alone: the live preview and plan block of the first attempt are not
// replayed, and the answer goes out as a new message under the operator's own, since the
// placeholder it would have replaced belongs to a run that has ended.
export async function redeliverAnswer(deps: OrchestratorDeps, answer: FinalAnswer): Promise<void> {
  await sendAnswer(deps, {
    reply: newReply(deps, {
      chatId: answer.chatId,
      messageId: answer.anchorMessageId,
      ...(answer.reactionRef === undefined ? {} : { reactionRef: answer.reactionRef }),
    }),
    answer,
    useMarkup: resolveOutboundMarkup(deps.adapter, deps.settings, true),
    afterApproval: false,
  })
}

function toFinalAnswer(locale: Locale, delivery: Delivery): FinalAnswer {
  const { combined, result } = delivery
  const plan = delivery.stream.plan()
  const metric = delivery.stream.metric()
  const body = formatRunResultBody(result, locale)

  return {
    chatId: combined.chatId,
    anchorMessageId: combined.messageId,
    ...(combined.reactionRef === undefined ? {} : { reactionRef: combined.reactionRef }),
    body: plan === undefined ? body : `${formatPlanBlock(plan)}\n\n${body}`,
    footer: formatChannelFooter(locale, result.totals, {
      ...(metric === undefined ? {} : { contextPct: metric.contextPct }),
      elapsedMs: delivery.elapsedMs,
    }),
    completed: result.reason === 'completed',
  }
}

async function sendAnswer(deps: OrchestratorDeps, send: AnswerSend): Promise<void> {
  const { adapter } = deps
  const { reply, answer, useMarkup } = send
  const renderer = selectRenderer(adapter, useMarkup)
  const maxLen = adapter.capabilities.maxTextLen
  const normalized = renderer.normalizeTables(answer.body)
  // The footer is glued on after chunking, so it is the one fragment that encodes itself.
  const renderedFooter = renderer.escape(answer.footer)
  const bodyChunks = renderer.chunk(normalized, maxLen)

  const chunks = buildFooterChunks(bodyChunks, renderedFooter, maxLen)
  const [head, ...rest] = chunks
  const refs: (SentRef | undefined)[] = []

  // Editing the placeholder would file the answer above the approval prompt it answers, so a run
  // that prompted sends its answer as a new message and leaves the live preview standing.
  if (head !== undefined) {
    refs.push(
      send.afterApproval
        ? await reply.overflow(head, { useMarkup, signal: deps.signal })
        : await reply.update(head, { useMarkup, retryOn429: true, signal: deps.signal })
    )
  }

  for (const chunk of rest) {
    refs.push(await reply.overflow(chunk, { useMarkup, signal: deps.signal }))
  }

  recordAnswerChunks(deps.sent, {
    chatId: answer.chatId,
    refs,
    bodyCount: bodyChunks.length,
    footerJoined: chunks.length === bodyChunks.length,
  })

  await reply.react(answer.completed ? '✅' : '❌')
}

interface AnswerChunks {
  readonly chatId: string
  readonly refs: readonly (SentRef | undefined)[]
  readonly bodyCount: number
  readonly footerJoined: boolean
}

// A footer-only chunk is all LLM spend, so it is never filed.
function recordAnswerChunks(sent: SentMessages, chunks: AnswerChunks): void {
  for (const [index, ref] of chunks.refs.slice(0, chunks.bodyCount).entries()) {
    if (ref === undefined) {
      continue
    }

    sent.record(chunks.chatId, ref.messageId, {
      kind: 'answer',
      hasFooter: chunks.footerJoined && index === chunks.bodyCount - 1,
    })
  }
}

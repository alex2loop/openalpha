import type { OperatorContext } from '@/channels/operator'
import type { ChannelAdapter, ChannelOutbound, OutboundButton, SentRef } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { EventBus } from '@/core/events'
import type { AgentId, RunId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { ApprovalScope } from '@/engine/api'
import type { MessageKey } from '@/i18n'
import { formatToolDisplay } from '@/channels/delivery/format'
import { operatorContextOf } from '@/channels/operator'
import { ChannelError } from '@/core/errors'
import { observe } from '@/core/events'
import { formatErrForLog } from '@/core/security/credentials'
import { truncate } from '@/core/utils/text'
import { sleep } from '@/core/utils/time'
import { type ApprovalDecision, composeAbort, decisionsFor } from '@/engine/api'
import {
  approvalDecisionLabel,
  approvalDetail,
  approvalOutcome,
  t,
  translateToolLabel,
} from '@/i18n'

// Prompts are answered by a human, so this is generous headroom rather than a working limit.
const MAX_PENDING_PROMPTS = 256
// Bounded: an absurd Retry-After would idle the prompt to its expiry.
const MAX_RETRY_AFTER_MS = 30_000

interface ProactiveDeps {
  readonly bus: EventBus
  readonly logger: Logger
  readonly adapter: ChannelAdapter
  readonly channelId: ChannelId
  readonly locale: Locale
  /** Channel-runtime lifetime: unsubscribes every bus handler when it aborts. */
  readonly signal: AbortSignal
  /** Operator authority for an approval tap; fail closed when the chat is unconfigured. */
  readonly isOperatorUser: (userId: string | undefined, context: OperatorContext) => boolean
}

export interface ApprovalResolution {
  readonly decision: ApprovalDecision
  readonly requestId: string
  /** The chat the tap came from. Only the chat that was prompted may answer. */
  readonly chatId: string
  readonly approvedBy: string
  /** Group taps must pass the fail-closed operator check; missing is treated as direct. */
  readonly isGroup?: boolean
}

export interface ProactiveSubscription {
  resolveApproval(input: ApprovalResolution): Promise<void>
  dispose(): void
}

interface PendingApproval {
  readonly chatId: string
  readonly messageId: string | null
  /** Exactly what this prompt rendered; a callback naming anything else was not offered. */
  readonly allowed: readonly ApprovalDecision[]
  /** Tool line and detail, replayed under the outcome so the chat keeps what was authorized. */
  readonly body: string
  readonly timer: ReturnType<typeof setTimeout>
}

export function subscribeProactive(deps: ProactiveDeps): ProactiveSubscription {
  const outstanding = new Map<string, PendingApproval | null>()
  // Channel shutdown or dispose: unsubscribes, cancels in-flight sends, blocks late registration.
  const { controller, dispose: detach } = composeAbort([deps.signal], undefined)
  const ctx: PromptContext = { outstanding, signal: controller.signal }

  observe(deps.bus, 'approval_requested', {
    signal: controller.signal,
    fn: (event) => handleRequest(deps, event, ctx),
  })

  return {
    async resolveApproval({ decision, requestId, chatId, approvedBy, isGroup }): Promise<void> {
      const entry = outstanding.get(requestId)

      // Unknown, already resolved, already retired, or not yet delivered.
      if (!entry) {
        return
      }

      // Checked before release: a rejected payload cannot retire a live prompt.
      if (entry.chatId !== chatId) {
        deps.logger.warn('proactive.approval_wrong_chat', { channel: deps.channelId })

        return
      }

      // The tapping member must be an operator: a group with no listed operators admits no one.
      if (!deps.isOperatorUser(approvedBy, operatorContextOf(isGroup, chatId))) {
        deps.logger.warn('proactive.approval_not_operator', { channel: deps.channelId })

        return
      }

      if (!entry.allowed.includes(decision)) {
        deps.logger.warn('proactive.decision_not_offered', { channel: deps.channelId, decision })

        return
      }

      clearTimeout(entry.timer)
      outstanding.delete(requestId)
      deps.bus.emit('approval_resolved', {
        requestId,
        decision,
        approvedBy,
        channel: deps.channelId,
      })

      try {
        await editNotice(deps, entry, approvalOutcome(deps.locale, decision))
      } catch (err: unknown) {
        deps.logger.warn('channel.approval_notice_edit_failed', {
          channel: deps.channelId,
          err: formatErrForLog(err),
        })
      }
    },

    dispose(): void {
      controller.abort()
      detach()

      // These die with the channel, including sends that may never settle.
      for (const requestId of outstanding.keys()) {
        failClosed(deps, ctx, requestId)
      }
    },
  }
}

// Exactly one resolution per request: removing the id claims the emit.
function failClosed(deps: ProactiveDeps, ctx: PromptContext, requestId: string): void {
  const entry = ctx.outstanding.get(requestId)

  if (!ctx.outstanding.delete(requestId)) {
    return
  }

  if (entry) {
    clearTimeout(entry.timer)
  }

  deps.bus.emit('approval_resolved', { requestId, decision: 'deny', channel: deps.channelId })
}

// The agent only reports a denial, which would read as though the operator refused.
function notifyUnsupported(deps: ProactiveDeps, chatId: string, signal: AbortSignal): void {
  deps.adapter
    .send(
      { channel: deps.channelId, chatId, text: t(deps.locale, 'channel.approvalUnsupported') },
      { signal }
    )
    .catch((err: unknown) => {
      deps.logger.debug('proactive.unsupported_notice_failed', { err: formatErrForLog(err) })
    })
}

interface ApprovalRequest {
  readonly requestId: string
  readonly runId: RunId
  readonly agentId: AgentId
  readonly toolName: string
  readonly label: string
  readonly emoji?: string
  readonly detail?: string
  readonly truncated?: true
  readonly chatId: string
  readonly channel: ChannelId
  readonly scope: ApprovalScope
  readonly oneTime?: true
  readonly expiresAt: number
}

interface PromptContext {
  /** Every request owed a resolution; `null` until its prompt lands. */
  readonly outstanding: Map<string, PendingApproval | null>
  readonly signal: AbortSignal
}

function handleRequest(deps: ProactiveDeps, event: ApprovalRequest, ctx: PromptContext): void {
  // Every surface shares one bus, so a run on another channel is not ours to prompt for.
  if (event.channel !== deps.channelId) {
    return
  }

  // Claimed before the async send, or concurrent requests all pass the cap check below.
  ctx.outstanding.set(event.requestId, null)

  // No buttons, no way to answer: an unanswerable prompt stalls the run to its deadline.
  if (!deps.adapter.capabilities.inlineButtons) {
    failClosed(deps, ctx, event.requestId)
    notifyUnsupported(deps, event.chatId, ctx.signal)

    return
  }

  if (ctx.outstanding.size > MAX_PENDING_PROMPTS) {
    deps.logger.warn('proactive.pending_full', { channel: deps.channelId })
    failClosed(deps, ctx, event.requestId)

    return
  }

  promptForApproval(deps, event, ctx).catch((err: unknown) => {
    deps.logger.warn('proactive.prompt_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
    failClosed(deps, ctx, event.requestId)
  })
}

async function promptForApproval(
  deps: ProactiveDeps,
  event: ApprovalRequest,
  ctx: PromptContext
): Promise<void> {
  const { locale } = deps

  // One read for the guard and the send's own deadline: they measure the same instant.
  const sendWindowMs = event.expiresAt - Date.now()

  if (sendWindowMs <= 0) {
    failClosed(deps, ctx, event.requestId)

    return
  }

  const allowed = decisionsFor(event.scope, event.oneTime)
  const title = t(locale, 'channel.approvalRequired')
  const policy = t(locale, resolveApprovalPolicyKey(event.scope))
  // Two newlines join the three parts; what the fixed copy leaves is the detail's room.
  const body = promptBody(
    locale,
    event,
    deps.adapter.capabilities.maxTextLen - title.length - policy.length - 2
  )
  // A send that outlives the gate must not land buttons it has stopped listening for.
  const delivery = composeAbort([ctx.signal], sendWindowMs)
  const sent = await sendPastRateLimit(deps.adapter, {
    out: {
      channel: deps.channelId,
      chatId: event.chatId,
      text: `${title}\n${body}\n${policy}`,
      buttons: approvalButtons(deps, event.requestId, allowed),
    },
    signal: delivery.controller.signal,
    expiresAt: event.expiresAt,
  }).finally(() => delivery.dispose())

  const remainingMs = event.expiresAt - Date.now()

  // Torn down or expired mid-send: registering now would leave live buttons that resolve nothing.
  if (ctx.signal.aborted || remainingMs <= 0) {
    failClosed(deps, ctx, event.requestId)

    return
  }

  // Takes the buttons away when the gate gives up; the gate denies on its own timer.
  const timer = setTimeout(() => {
    const entry = ctx.outstanding.get(event.requestId)
    ctx.outstanding.delete(event.requestId)

    if (entry) {
      editNotice(deps, entry, t(locale, 'channel.approvalTimedOut')).catch((err: unknown) => {
        deps.logger.debug('proactive.timeout_notice_failed', { err: formatErrForLog(err) })
      })
    }
  }, remainingMs)

  ctx.outstanding.set(event.requestId, {
    chatId: event.chatId,
    messageId: sent.messageId,
    allowed,
    body,
    timer,
  })
}

interface RateLimitedSend {
  readonly out: ChannelOutbound
  readonly signal: AbortSignal
  readonly expiresAt: number
}

/** A 429 here must not become a silent deny: the caller's catch fails closed, answering for an
 *  operator who never saw the question. Bounded by `expiresAt`, after which the error stands. */
async function sendPastRateLimit(
  adapter: ChannelAdapter,
  options: RateLimitedSend
): Promise<SentRef> {
  for (;;) {
    try {
      return await adapter.send(options.out, { signal: options.signal })
    } catch (err: unknown) {
      const waitMs = rateLimitWaitMs(err, options.expiresAt)

      if (waitMs === undefined) {
        throw err
      }

      await sleep(waitMs, options.signal)
    }
  }
}

/** Absent unless the provider named a window the prompt can still outlive. */
function rateLimitWaitMs(err: unknown, expiresAt: number): number | undefined {
  if (!(err instanceof ChannelError) || err.retryAfterMs === undefined) {
    return undefined
  }

  const waitMs = Math.min(err.retryAfterMs, MAX_RETRY_AFTER_MS)

  return expiresAt - Date.now() > waitMs ? waitMs : undefined
}

// The engine-resolved presentation, never `argsSummary`: the channel has no verbose mode to hide a
// raw JSON preview behind. The detail takes its own line: glued to the header it truncates exactly
// where the operator needs to read. Carries no state line of its own, so the caller can head it with
// "approval required" while pending and with the outcome once settled.
/** A tool argument is unbounded and an approval prompt carries buttons, so it cannot be split the
 *  way a notice is. The detail is what yields: an operator who cannot read the policy line cannot
 *  answer the question. */
function promptBody(locale: Locale, event: ApprovalRequest, maxLen: number): string {
  const display = formatToolDisplay({
    label: translateToolLabel(locale, event.toolName, event.label),
    ...(event.emoji === undefined ? {} : { emoji: event.emoji }),
  })
  const room = maxLen - display.length - 1

  const detail = approvalDetail(locale, event.detail, event.truncated)

  if (detail === undefined || room <= 0) {
    return truncate(display, maxLen)
  }

  return `${display}\n${truncate(detail, room)}`
}

function resolveApprovalPolicyKey(scope: ApprovalScope): MessageKey {
  switch (scope.kind) {
    case 'delegated':
      return 'channel.approvalDelegatedOnce'
    case 'scheduler':
      return 'channel.approvalSchedulerOnce'
    case 'session':
    case 'mcp':
      return 'channel.approvalRememberSession'
  }
}

function approvalButtons(
  deps: ProactiveDeps,
  requestId: string,
  allowed: readonly ApprovalDecision[]
): readonly OutboundButton[] {
  return allowed.map((decision) => ({
    label: approvalDecisionLabel(deps.locale, decision),
    callbackId: `${decision}:${requestId}`,
  }))
}

// Replaces the live prompt with what was asked plus its outcome. Carrying no buttons, the edit is
// also what disarms them: a delete would leave a live keyboard whenever it failed.
async function editNotice(
  deps: ProactiveDeps,
  entry: PendingApproval,
  outcome: string
): Promise<void> {
  const { adapter } = deps

  if (!(entry.messageId && adapter.capabilities.canEdit && adapter.edit)) {
    return
  }

  await adapter.edit({
    chatId: entry.chatId,
    messageId: entry.messageId,
    text: `${outcome}\n${entry.body}`,
  })
}

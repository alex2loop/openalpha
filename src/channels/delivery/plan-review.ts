import { randomUUID } from 'node:crypto'

import type { TextChoices } from '@/channels/delivery/choices'
import type { OperatorContext } from '@/channels/operator'
import type { ChannelAdapter, OutboundButton } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { ResearchPlanDecision, ResearchPlanReview } from '@/engine/api'
import type { MessageKey } from '@/i18n'
import { replyChoiceGone } from '@/channels/delivery/choice-gone'
import { operatorContextOf } from '@/channels/operator'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

// A human answers this; generous headroom rather than a working limit.
const MAX_PENDING_REVIEWS = 64
const PLAN_REVIEW_TIMEOUT_MS = 180_000

type ChannelPlanDecision = 'start' | 'cancel'

interface ChannelPlanReviewerDeps {
  readonly adapter: ChannelAdapter
  readonly channelId: ChannelId
  readonly locale: Locale
  readonly logger: Logger
  /** Channel-runtime lifetime: every pending review fails closed when it aborts. */
  readonly signal: AbortSignal
  /** Typed codes for a channel without a keyboard; shared with the approval prompts. */
  readonly choices: TextChoices
  /** Operator authority for a decision tap; fail closed when the chat is unconfigured. */
  readonly isOperatorUser: (userId: string | undefined, context: OperatorContext) => boolean
}

export interface PlanDecisionResolution {
  readonly decision: ChannelPlanDecision
  readonly requestId: string
  /** The chat the tap came from. Only the chat that was prompted may answer. */
  readonly chatId: string
  readonly decidedBy: string
  /** Group taps must pass the fail-closed operator check; missing is treated as direct. */
  readonly isGroup?: boolean
}

export interface ChannelPlanReviewer {
  reviewPlan(chatId: string, input: ResearchPlanReview): Promise<ResearchPlanDecision>
  resolveDecision(input: PlanDecisionResolution): Promise<void>
  dispose(): void
}

type SettleReview = (decision: ChannelPlanDecision, notice: MessageKey | undefined) => void

interface PendingReview {
  readonly chatId: string
  readonly settle: SettleReview
}

// Both are known only once the prompt has been delivered; a review settled before that has neither.
interface ReviewState {
  messageId?: string
  timer?: ReturnType<typeof setTimeout>
}

export function toPlanDecision(action: string): ChannelPlanDecision | undefined {
  if (action === 'plan_start') {
    return 'start'
  }
  if (action === 'plan_cancel') {
    return 'cancel'
  }
  return undefined
}

export function createChannelPlanReviewer(deps: ChannelPlanReviewerDeps): ChannelPlanReviewer {
  const pending = new Map<string, PendingReview>()

  return {
    async reviewPlan(chatId, input): Promise<ResearchPlanDecision> {
      if (deps.signal.aborted || input.signal.aborted) {
        return { kind: 'cancel' }
      }

      if (pending.size >= MAX_PENDING_REVIEWS) {
        deps.logger.warn('plan_review.pending_full', { channel: deps.channelId })
        return { kind: 'cancel' }
      }

      // One instant for the typed codes' lifetime and the review timer, so both end together.
      const expiresAt = Date.now() + PLAN_REVIEW_TIMEOUT_MS
      const requestId = randomUUID()
      const buttons = planButtons(deps.locale, requestId)
      const keyboard = deps.adapter.capabilities.inlineButtons
      const choiceLines = keyboard ? [] : deps.choices.offer({ chatId, buttons, expiresAt })

      // No keyboard and no free code: nothing could answer, so the run is not left waiting.
      if (!keyboard && choiceLines.length === 0) {
        await notifyUnsupported(deps, chatId, input.signal)
        return { kind: 'cancel' }
      }

      const offer: PlanOffer = { buttons: keyboard ? buttons : [], choiceLines, expiresAt }

      return awaitDecision({ deps, pending, chatId, input, requestId, offer })
    },

    async resolveDecision(input): Promise<void> {
      const entry = pending.get(input.requestId)

      // Unknown, already resolved, or retired by timeout/abort: an operator who tapped it hears so.
      if (entry === undefined) {
        await replyChoiceGone(deps, input.chatId)

        return
      }

      // Checked before release: a rejected payload cannot retire a live prompt.
      if (entry.chatId !== input.chatId) {
        deps.logger.warn('plan_review.wrong_chat', { channel: deps.channelId })
        return
      }

      // The tapping member must be an operator: a group with no listed operators admits no one.
      if (!deps.isOperatorUser(input.decidedBy, operatorContextOf(input.isGroup, input.chatId))) {
        deps.logger.warn('plan_review.not_operator', { channel: deps.channelId })
        return
      }

      entry.settle(input.decision, decisionNotice(input.decision))
    },

    dispose(): void {
      for (const entry of [...pending.values()]) {
        entry.settle('cancel', undefined)
      }
    },
  }
}

/** How the prompt asks: buttons on a keyboard, else lines naming the codes to type back. */
interface PlanOffer {
  readonly buttons: readonly OutboundButton[]
  readonly choiceLines: readonly string[]
  readonly expiresAt: number
}

interface AwaitDecisionInput {
  readonly deps: ChannelPlanReviewerDeps
  readonly pending: Map<string, PendingReview>
  readonly chatId: string
  readonly input: ResearchPlanReview
  readonly requestId: string
  readonly offer: PlanOffer
}

// Every path settles exactly once: tap, timeout, run abort, channel shutdown, or dispose. The slot
// is registered before delivery starts, so a teardown mid-send releases the caller immediately.
function awaitDecision(wait: AwaitDecisionInput): Promise<ResearchPlanDecision> {
  const { deps, pending, chatId, input, requestId } = wait

  return new Promise<ResearchPlanDecision>((resolve) => {
    const state: ReviewState = {}
    const settle: SettleReview = (decision, notice): void => {
      if (!pending.delete(requestId)) {
        return
      }

      clearTimeout(state.timer)
      input.signal.removeEventListener('abort', onAbort)
      deps.signal.removeEventListener('abort', onAbort)

      if (notice !== undefined && state.messageId !== undefined) {
        // editNotice logs its own failures and never rejects.
        editNotice(deps, { chatId, messageId: state.messageId }, notice).catch(() => undefined)
      }
      resolve(decision === 'start' ? { kind: 'start' } : { kind: 'cancel' })
    }
    const onAbort = (): void => settle('cancel', 'channel.researchPlanCancelled')

    pending.set(requestId, { chatId, settle })
    input.signal.addEventListener('abort', onAbort, { once: true })
    deps.signal.addEventListener('abort', onAbort, { once: true })

    deliverPrompt(wait, state, settle).catch(() => undefined)
  })
}

// Never rejects: delivery failure cancels the review, and the run and channel signals both cancel
// the send so a stalled transport cannot outlive either.
async function deliverPrompt(
  wait: AwaitDecisionInput,
  state: ReviewState,
  settle: SettleReview
): Promise<void> {
  const { deps, pending, chatId, input, requestId, offer } = wait
  let messageId: string

  try {
    const sent = await deps.adapter.send(
      {
        channel: deps.channelId,
        chatId,
        text: renderPlanText(deps, input, offer.choiceLines),
        ...(offer.buttons.length === 0 ? {} : { buttons: offer.buttons }),
      },
      { signal: AbortSignal.any([input.signal, deps.signal]) }
    )
    messageId = sent.messageId
  } catch (err: unknown) {
    deps.logger.warn('plan_review.prompt_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
    settle('cancel', undefined)

    return
  }

  // Settled while the prompt was in flight: retire the buttons rather than leave them resolving
  // nothing.
  if (!pending.has(requestId)) {
    await editNotice(deps, { chatId, messageId }, 'channel.researchPlanCancelled')

    return
  }

  state.messageId = messageId
  state.timer = setTimeout(
    () => settle('cancel', 'channel.researchPlanTimedOut'),
    Math.max(0, offer.expiresAt - Date.now())
  )
}

function decisionNotice(decision: ChannelPlanDecision): MessageKey {
  return decision === 'start' ? 'channel.researchPlanStarted' : 'channel.researchPlanCancelled'
}

function planButtons(locale: Locale, requestId: string): readonly OutboundButton[] {
  return [
    { label: t(locale, 'channel.researchPlanStartLabel'), callbackId: `plan_start:${requestId}` },
    { label: t(locale, 'channel.researchPlanCancelLabel'), callbackId: `plan_cancel:${requestId}` },
  ]
}

function renderPlanText(
  deps: ChannelPlanReviewerDeps,
  input: ResearchPlanReview,
  choiceLines: readonly string[]
): string {
  const { locale } = deps
  const lines = [
    t(locale, 'channel.researchPlanReview'),
    t(locale, 'channel.researchPlanObjective', { value: input.objective.normalized }),
    ...input.plan.questions.map((question, index) =>
      t(locale, 'channel.researchPlanItem', { index: index + 1, question: question.question })
    ),
    t(locale, 'channel.researchPlanLimits', {
      questions: input.limits.maxQuestions,
      rounds: input.limits.maxReviewRounds,
    }),
  ]

  // The plan yields to the codes, so the cut never lands inside one.
  const codes = choiceLines.length === 0 ? '' : `\n${choiceLines.join('\n')}`
  const room = deps.adapter.capabilities.maxTextLen - codes.length

  return `${lines.join('\n').slice(0, room)}${codes}`
}

async function notifyUnsupported(
  deps: ChannelPlanReviewerDeps,
  chatId: string,
  signal: AbortSignal
): Promise<void> {
  try {
    await deps.adapter.send(
      {
        channel: deps.channelId,
        chatId,
        text: t(deps.locale, 'channel.researchPlanUnsupported'),
      },
      { signal }
    )
  } catch (err: unknown) {
    deps.logger.debug('plan_review.unsupported_notice_failed', { err: formatErrForLog(err) })
  }
}

// Replaces the live prompt with its outcome so the buttons cannot be tapped a second time; a
// channel that cannot edit hears the outcome as a message of its own.
async function editNotice(
  deps: ChannelPlanReviewerDeps,
  target: { readonly chatId: string; readonly messageId: string },
  notice: MessageKey
): Promise<void> {
  const { adapter } = deps
  const text = t(deps.locale, notice)

  try {
    if (adapter.capabilities.canEdit && adapter.edit) {
      await adapter.edit({ chatId: target.chatId, messageId: target.messageId, text })
    } else {
      await adapter.send(
        { channel: deps.channelId, chatId: target.chatId, text },
        { signal: deps.signal }
      )
    }
  } catch (err: unknown) {
    deps.logger.warn('plan_review.notice_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

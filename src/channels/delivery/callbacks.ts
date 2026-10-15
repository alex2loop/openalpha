import type { ActiveSlashRuns } from '@/channels/delivery/active-runs'
import type { ApprovalResolution } from '@/channels/delivery/outbound/proactive'
import type { PlanDecisionResolution } from '@/channels/delivery/plan-review'
import type { ChannelAdapter, ChannelCallbackQuery } from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import { toPlanDecision } from '@/channels/delivery/plan-review'
import { type SessionId, sessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { APPROVAL_DECISIONS, type ApprovalDecision, type RunRegistry } from '@/engine/api'
import { t } from '@/i18n'

// Button payloads are `action:rest`.
const DATA_SEPARATOR = ':'
const ABORT_ACTION = 'abort'
/** What a button carrying a command is prefixed with. One owner for the vocabulary both the sender
 *  and the router speak, so a tap cannot mean one thing on the way out and another on the way in. */
export const COMMAND_CALLBACK_ACTION = 'cmd:'

interface CallbackDeps {
  readonly adapter: ChannelAdapter
  readonly runRegistry: RunRegistry
  readonly slashRuns: ActiveSlashRuns
  readonly logger: Logger
  readonly locale: Locale
  /** Owned by outbound/proactive.ts, which holds the pending-approval map. */
  readonly resolveApproval: (input: ApprovalResolution) => Promise<void>
  /** Owned by delivery/plan-review.ts, which holds the pending research-plan map. */
  readonly resolvePlanDecision: (input: PlanDecisionResolution) => void
}

export async function dispatchCallbackQuery(
  deps: CallbackDeps,
  query: ChannelCallbackQuery
): Promise<void> {
  // Authorization keys on the originating chat; without one, nothing here can be authorized.
  if (query.chatId === undefined) {
    return
  }

  const sep = query.data.indexOf(DATA_SEPARATOR)

  if (sep <= 0) {
    return
  }

  const action = query.data.slice(0, sep)
  const rest = query.data.slice(sep + 1)

  if (action === ABORT_ACTION) {
    await abortSession(deps, query, { chatId: query.chatId, sessionId: rest })

    return
  }

  if (isApproval(action)) {
    await deps.resolveApproval({
      decision: action,
      requestId: rest,
      chatId: query.chatId,
      approvedBy: query.from,
      ...(query.isGroup === undefined ? {} : { isGroup: query.isGroup }),
    })

    return
  }

  const planDecision = toPlanDecision(action)

  if (planDecision !== undefined) {
    deps.resolvePlanDecision({
      decision: planDecision,
      requestId: rest,
      chatId: query.chatId,
      decidedBy: query.from,
      ...(query.isGroup === undefined ? {} : { isGroup: query.isGroup }),
    })

    return
  }

  deps.logger.debug('callbacks.unknown_action', { channel: query.channel, action })
}

function isApproval(action: string): action is ApprovalDecision {
  return APPROVAL_DECISIONS.some((decision) => decision === action)
}

// The payload proposes a session; the live run's own identity decides whether this chat owns it.
async function abortSession(
  deps: CallbackDeps,
  query: ChannelCallbackQuery,
  target: { readonly chatId: string; readonly sessionId: string }
): Promise<void> {
  const id = sessionId(target.sessionId)
  const runAborted = deps.runRegistry.abortSession(id, target.chatId)

  // A slash run reports its own cancellation through its notice, which owns that message.
  deps.slashRuns.abortSession(id, target.chatId)

  // Nothing running here: already finished, or it belongs to another chat. Nothing to report.
  if (!(runAborted && query.messageId)) {
    return
  }

  const cancelled = t(deps.locale, 'channel.cancelled')

  try {
    if (deps.adapter.capabilities.canEdit && deps.adapter.edit) {
      await deps.adapter.edit({
        chatId: target.chatId,
        messageId: query.messageId,
        text: cancelled,
      })

      return
    }

    await deps.adapter.send({ channel: query.channel, chatId: target.chatId, text: cancelled })
  } catch (err: unknown) {
    // The run is already aborted; failing to say so must not surface as an error.
    deps.logger.warn('callbacks.cancel_notice_failed', {
      channel: query.channel,
      err: formatErrForLog(err),
    })
  }
}

/** What a cancel button carries, so the one parser above is the only place the shape is known. */
export function buildAbortCallbackData(id: SessionId): string {
  return `${ABORT_ACTION}${DATA_SEPARATOR}${id}`
}

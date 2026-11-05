import type { SentMessages } from '@/channels/delivery/sent-messages'
import type { ChannelSettings } from '@/channels/schema'
import type { InboundMessage } from '@/channels/types'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { SessionActivity } from '@/core/types/session'
import { resolveGapNote } from '@/channels/delivery/gap-note'
import { toReplyLead } from '@/channels/delivery/reply-context'

const LEAD_SEPARATOR = '\n\n'

interface LeadDeps {
  readonly sessions: SessionActivity
  readonly settings: Pick<ChannelSettings, 'gapNoteMs'>
  readonly sent: Pick<SentMessages, 'get'>
  readonly locale: Locale
  readonly logger: Logger
}

interface LeadExchange {
  readonly combined: InboundMessage
  readonly sessionId: SessionId
}

// Batched messages arrive here as one: one lead per run, and a burst keeps only its last reply.
export async function composeLead(
  deps: LeadDeps,
  exchange: LeadExchange
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

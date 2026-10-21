import type { SentMessage, SentMessages } from '@/channels/delivery/sent-messages'
import type { InboundMessage, InboundReply } from '@/channels/types'
import type { Locale } from '@/core/types/locale'
import { stripFooter } from '@/channels/delivery/format'
import { toPastedContent } from '@/core/security/pasted-content'
import { truncate } from '@/core/utils/text'
import { t } from '@/i18n'

const REPLY_CONTEXT_MAX_CHARS = 1_500

type AnswerMessage = Extract<SentMessage, { readonly kind: 'answer' }>

interface ReplyLeadInput {
  readonly message: InboundMessage
  readonly sent: Pick<SentMessages, 'get'>
  readonly locale: Locale
}

/** Only an answer lets text through, footer cut; a notice passes its label and anything else a
 *  pointer, so no figure the bot sent reaches a model through a reply. */
export function toReplyLead(input: ReplyLeadInput): string | undefined {
  const { message, locale } = input
  const { replyTo } = message

  if (replyTo === undefined) {
    return undefined
  }

  const sent = input.sent.get(message.chatId, replyTo.messageId)

  return toKnownLead(sent, replyTo, locale) ?? t(locale, 'channel.replyContext.unknown')
}

function toKnownLead(
  sent: SentMessage | undefined,
  replyTo: InboundReply,
  locale: Locale
): string | undefined {
  if (sent === undefined) {
    return undefined
  }

  switch (sent.kind) {
    case 'answer':
      return toAnswerLead(sent, replyTo)
    case 'notice':
      return t(locale, 'channel.replyContext.notice', { label: sent.label })
    default: {
      const _exhaustive: never = sent

      return _exhaustive
    }
  }
}

// A quote that reaches into the footer falls back to the whole body.
function toAnswerLead(sent: AnswerMessage, replyTo: InboundReply): string | undefined {
  if (replyTo.text === undefined) {
    return undefined
  }

  const body = sent.hasFooter ? stripFooter(replyTo.text) : replyTo.text
  const quote = replyTo.quote
  const chosen = quote !== undefined && quote !== '' && body.includes(quote) ? quote : body
  const trimmed = chosen.trim()

  return trimmed === '' ? undefined : toPastedContent(truncate(trimmed, REPLY_CONTEXT_MAX_CHARS))
}

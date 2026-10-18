import type { SentMessage, SentMessages } from '@/channels/delivery/sent-messages'
import type { InboundMessage, InboundReply } from '@/channels/types'
import type { Locale } from '@/core/types/locale'
import { stripFooter } from '@/channels/delivery/format'
import { toPastedContent } from '@/channels/pasted-content'
import { truncate } from '@/core/utils/text'
import { t } from '@/i18n'

const REPLY_CONTEXT_MAX_CHARS = 1_500

type AnswerMessage = Extract<SentMessage, { readonly kind: 'answer' }>

interface ReplyContextInput {
  readonly message: InboundMessage
  readonly sent: Pick<SentMessages, 'get'>
  readonly locale: Locale
}

/** The operator's text, led by what they are replying to. Only an answer lets text through, with
 *  its run footer (LLM spend) removed; a notice passes its label alone, and anything else a pointer,
 *  so no amount or cost figure the bot once sent reaches a model through a reply. */
export function withReplyContext(input: ReplyContextInput): string {
  const { message, locale } = input
  const { replyTo } = message

  if (replyTo === undefined) {
    return message.text
  }

  const sent = input.sent.get(message.chatId, replyTo.messageId)

  return `${toLead(sent, replyTo, locale)}\n\n${message.text}`
}

function toLead(sent: SentMessage | undefined, replyTo: InboundReply, locale: Locale): string {
  if (sent === undefined) {
    return t(locale, 'channel.replyContext.unknown')
  }

  switch (sent.kind) {
    case 'answer':
      return toAnswerLead(sent, replyTo) ?? t(locale, 'channel.replyContext.unknown')
    case 'notice':
      return t(locale, 'channel.replyContext.notice', { label: sent.label })
    default: {
      // Exhaustive - unreachable per SentMessage union.
      const _exhaustive: never = sent

      return _exhaustive
    }
  }
}

// The operator's own selection wins, but only when it lies inside the body: a quote that touches
// the footer falls back to the whole footer-less body.
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

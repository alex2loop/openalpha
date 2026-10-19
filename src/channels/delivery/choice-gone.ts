import type { ChannelAdapter } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

interface ChoiceGoneDeps {
  readonly adapter: ChannelAdapter
  readonly channelId: ChannelId
  readonly locale: Locale
  readonly logger: Logger
  readonly signal: AbortSignal
}

/** An admitted operator answered a prompt that is no longer open: it was answered already, or its
 *  time ran out. Saying so beats silence, which reads as a bot that ignored the tap. A failed send
 *  is logged and dropped. */
export async function replyChoiceGone(deps: ChoiceGoneDeps, chatId: string): Promise<void> {
  try {
    await deps.adapter.send(
      { channel: deps.channelId, chatId, text: t(deps.locale, 'channel.choiceGone') },
      { signal: deps.signal }
    )
  } catch (err: unknown) {
    deps.logger.warn('channel.choice_gone_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

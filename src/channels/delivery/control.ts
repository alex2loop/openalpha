import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { ChannelCallbackQuery, InboundMessage } from '@/channels/types'
import type { SessionId } from '@/core/ids'
import { replyChoiceGone } from '@/channels/delivery/choice-gone'
import { commandHeadOf } from '@/commands/api'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const STOP_COMMAND = '/stop'

interface SessionControlOptions {
  readonly deps: InboundHandlerDeps
  readonly msg: InboundMessage
  readonly sessionId: SessionId
}

interface ControlHelpEntry {
  readonly verb: string
  readonly description: string
}

export async function handleControlCallback(
  deps: InboundHandlerDeps,
  query: ChannelCallbackQuery
): Promise<void> {
  if (!(await deps.gate.admitCallback(query))) {
    deps.logger.warn('inbound.callback_rejected', { channel: deps.channelId })

    return
  }

  await deps.onCallback(query)
}

/** On a channel without a keyboard, a code the bot minted in this chat answers its prompt as a tap
 *  would, through the same admission. True when the message was a code. */
export async function handleTypedChoice(
  deps: InboundHandlerDeps,
  msg: InboundMessage
): Promise<boolean> {
  if (deps.adapter.capabilities.inlineButtons || !deps.choices.isCode(msg.text)) {
    return false
  }

  const found = deps.choices.lookup(msg.chatId, msg.text)

  // Never handed out in this chat: the sender's own text.
  if (found === undefined) {
    return false
  }

  const query: ChannelCallbackQuery = {
    channel: deps.channelId,
    id: msg.messageId,
    data: found.kind === 'live' ? found.callbackId : '',
    from: msg.userId,
    chatId: msg.chatId,
    ...(msg.isGroup === undefined ? {} : { isGroup: msg.isGroup }),
  }

  if (found.kind === 'live') {
    await handleControlCallback(deps, query)

    return true
  }

  // Only the operator could have held the code; anyone else typed four digits of their own.
  if (!(await deps.gate.admitCallback(query))) {
    return false
  }

  await replyChoiceGone(deps, msg.chatId)

  return true
}

export async function handleSessionControl(options: SessionControlOptions): Promise<boolean> {
  const { deps, msg, sessionId } = options
  if (commandHeadOf(msg.text) === STOP_COMMAND) {
    deps.queue.cancelSession(sessionId)
    const workflowAborted = deps.slashRuns.abortSession(sessionId, msg.chatId)
    const runAborted = deps.runRegistry.abortSession(sessionId, msg.chatId)
    const aborted = workflowAborted || runAborted

    await ackOrLog(deps, msg.chatId, t(deps.locale, aborted ? 'slash.cancelYes' : 'slash.cancelNo'))
    return true
  }

  return false
}

async function ackOrLog(deps: InboundHandlerDeps, chatId: string, text: string): Promise<void> {
  try {
    await deps.sendText(chatId, text)
  } catch (err: unknown) {
    deps.logger.warn('channel.control_ack_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

export function channelControlHelp(
  locale: InboundHandlerDeps['locale']
): readonly ControlHelpEntry[] {
  return [
    { verb: STOP_COMMAND, description: t(locale, 'slash.helpStop') },
    { verb: '/help', description: t(locale, 'slash.helpHelp') },
  ]
}

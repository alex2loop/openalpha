import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { ChannelCallbackQuery, InboundMessage } from '@/channels/types'
import type { SessionId } from '@/core/ids'
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

/** Whether the query was admitted: a refused one reaches no resolver, so nothing it names is used. */
export async function handleControlCallback(
  deps: InboundHandlerDeps,
  query: ChannelCallbackQuery
): Promise<boolean> {
  if (!(await deps.gate.admitCallback(query))) {
    deps.logger.warn('inbound.callback_rejected', { channel: deps.channelId })

    return false
  }

  await deps.onCallback(query)

  return true
}

/** On a channel without a keyboard, a code the bot minted in this chat answers its prompt as a tap
 *  would. Admission runs before the code is consumed, so a member who is not the operator leaves it
 *  live for the one who is. True when the message was a code this path handled. */
export async function handleTypedChoice(
  deps: InboundHandlerDeps,
  msg: InboundMessage
): Promise<boolean> {
  if (deps.adapter.capabilities.inlineButtons || !deps.choices.isCode(msg.text)) {
    return false
  }

  const data = deps.choices.peek(msg.chatId, msg.text)
  const query: ChannelCallbackQuery = {
    channel: deps.channelId,
    id: msg.messageId,
    data: data ?? '',
    from: msg.userId,
    chatId: msg.chatId,
    ...(msg.isGroup === undefined ? {} : { isGroup: msg.isGroup }),
  }

  if (data === undefined) {
    // A code nobody here holds is the sender's own text unless they could have held one.
    if (!(await deps.gate.admitCallback(query))) {
      return false
    }

    await ackOrLog(deps, msg.chatId, t(deps.locale, 'channel.choiceGone'))

    return true
  }

  if (await handleControlCallback(deps, query)) {
    deps.choices.discard(msg.chatId, msg.text)
  }

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

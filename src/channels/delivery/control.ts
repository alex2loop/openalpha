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

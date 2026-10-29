import type { CommandLocales, CommandTranscript } from '@/commands/types'
import type { Logger } from '@/core/logging/logger'
import type {
  CommandExchange,
  SlashContext,
  SlashInvocationPolicy,
  SlashResult,
} from '@/core/types/command'
import { formatErrForLog } from '@/core/security/credentials'

import { renderMessages } from './render'
import { commandHeadOf } from './resolve'

interface ExchangeInput {
  readonly transcript: CommandTranscript
  readonly locales: CommandLocales
  readonly logger: Logger
  readonly context: SlashContext
  /** The line as the session's history shows it. */
  readonly invocation: string
  /** Absent for a line naming no command. */
  readonly policy?: SlashInvocationPolicy
  readonly result: SlashResult
}

/**
 * Records what the operator ran and what it answered, as every surface shows it: a `text` result
 * as written, a `message` result rendered in the session's locale. An echoed `text` result
 * (`transcript: 'echo'`) is model context, so the next agent turn in this session can be asked
 * about it; every other answer is display-only, kept for the session's history and never read back
 * by the model. A command that moves the chat to another session (`transcript: 'none'`) and a
 * scheduled job's non-echo answer keep nothing. A failed write is logged and the answer still goes
 * out: it costs the history and the follow-up context and nothing else.
 */
export async function appendExchange(input: ExchangeInput): Promise<void> {
  try {
    const exchange = toExchange(input)

    if (exchange !== undefined) {
      await input.transcript.appendCommandExchange(input.context.sessionId, exchange)
    }
  } catch (err: unknown) {
    input.logger.warn('commands.transcript_failed', {
      command: commandHeadOf(input.invocation),
      err: formatErrForLog(err),
    })
  }
}

// A result handed to an agent turn is that turn's to record, and a handled one showed nothing.
function toExchange(input: ExchangeInput): CommandExchange | undefined {
  const { result, context, invocation } = input
  const run = context.runId === undefined ? {} : { runId: context.runId }
  const isEcho = result.kind === 'text' && input.policy?.transcript === 'echo'

  if (input.policy?.transcript === 'none' || (context.isScheduled === true && !isEcho)) {
    return undefined
  }

  switch (result.kind) {
    case 'text':
      return isEcho
        ? { invocation, output: result.text, ...run }
        : { invocation, output: result.text, ...run, displayOnly: true }
    case 'message':
      return {
        invocation,
        output: renderMessages(input.locales(context.locale), result),
        ...run,
        displayOnly: true,
      }
    case 'agent':
    case 'handled':
      return undefined
    default: {
      // Exhaustive - unreachable per SlashResult union.
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

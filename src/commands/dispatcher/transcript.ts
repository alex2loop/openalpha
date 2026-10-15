import type { CommandTranscript } from '@/commands/types'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { SlashInvocationPolicy, SlashResult } from '@/core/types/command'
import { formatErrForLog } from '@/core/security/credentials'

interface ExchangeInput {
  readonly transcript: CommandTranscript
  readonly logger: Logger
  readonly sessionId: SessionId
  readonly name: string
  readonly args: readonly string[]
  readonly policy: SlashInvocationPolicy
  readonly result: SlashResult
}

/**
 * Records what the operator ran and what it answered, so the next agent turn in this session can be
 * asked about it. Only a `text` result is recorded: a `message` result is a localized notice the
 * surface renders, and rendering it here would need i18n, which this module may not import. The
 * answer is already on screen by the time this runs, so a failed write costs the follow-up context
 * and nothing else.
 */
export async function appendExchange(input: ExchangeInput): Promise<void> {
  const { policy, result } = input

  if (policy.transcript !== 'echo' || result.kind !== 'text') {
    return
  }

  try {
    await input.transcript.appendCommandExchange(input.sessionId, {
      invocation: [`/${input.name}`, ...input.args].join(' '),
      output: result.text,
    })
  } catch (err: unknown) {
    input.logger.warn('commands.transcript_failed', {
      command: input.name,
      err: formatErrForLog(err),
    })
  }
}

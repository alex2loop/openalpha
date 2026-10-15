import type { Logger } from '@/core/logging/logger'
import type { FinishReason, StreamEvent } from '@/core/stream-events'
import { LLMError } from '@/core/errors'

const FINISH_REASONS: Readonly<Record<string, FinishReason>> = {
  stop: 'stop',
  length: 'length',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'content_filter',
}
/** OpenRouter ends a stream that failed mid-way with this reason rather than a status. */
const ERROR_FINISH_REASON = 'error'

/** A reason the table does not know still ends the stream; it only adds no finish event, so the
 *  runner infers `tool_use` or `stop` from what arrived. */
export function chatFinishEvents(reason: string, logger: Logger): readonly StreamEvent[] {
  if (reason === ERROR_FINISH_REASON) {
    throw new LLMError('transient', 'the provider ended the stream with an error')
  }

  const mapped = FINISH_REASONS[reason]

  if (mapped === undefined) {
    logger.warn('ai.unknown_finish_reason', { finishReason: reason })

    return []
  }

  return [{ type: 'finish_reason', reason: mapped }]
}

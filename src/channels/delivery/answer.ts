import { ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { isPlainRecord } from '@/core/utils/collections'

// A run's answer is bounded by its model's output limit, so this is never reached in practice. Past
// it the answer is not kept and the entry is retried as it always was: re-sending a truncated answer
// would be a silent loss, re-running one is only spend.
const MAX_STORED_ANSWER_CHARS = 262_144

/** What re-sending a finished run's final message needs, before any destination renders it. */
export interface FinalAnswer {
  readonly chatId: string
  /** Last inbound message of the exchange. Of the inbox entries that fed it, only this one
   *  re-sends; the rest of the burst complete without a reply of their own. */
  readonly anchorMessageId: string
  readonly reactionRef?: string
  /** Markdown: the plan block, when the run showed one, then the answer text. */
  readonly body: string
  readonly footer: string
  readonly completed: boolean
}

/** The run finished and its final write failed. Carries the answer so the inbox keeps it and the
 *  retry sends it instead of running the agent again. */
export class AnswerUndelivered extends ChannelError {
  constructor(
    readonly answer: FinalAnswer,
    cause: unknown
  ) {
    super('send_failed', `final answer was not delivered: ${formatErrForLog(cause).message}`, {
      cause,
    })
  }
}

export function encodeAnswer(answer: FinalAnswer): string | undefined {
  const encoded = JSON.stringify(answer)

  return encoded.length > MAX_STORED_ANSWER_CHARS ? undefined : encoded
}

/** Undefined when the stored text is not an answer. */
export function decodeAnswer(raw: string): FinalAnswer | undefined {
  const parsed = parseJson(raw)

  if (
    isPlainRecord(parsed) &&
    typeof parsed.chatId === 'string' &&
    typeof parsed.anchorMessageId === 'string' &&
    (parsed.reactionRef === undefined || typeof parsed.reactionRef === 'string') &&
    typeof parsed.body === 'string' &&
    typeof parsed.footer === 'string' &&
    typeof parsed.completed === 'boolean'
  ) {
    return {
      chatId: parsed.chatId,
      anchorMessageId: parsed.anchorMessageId,
      body: parsed.body,
      footer: parsed.footer,
      completed: parsed.completed,
      ...(typeof parsed.reactionRef === 'string' ? { reactionRef: parsed.reactionRef } : {}),
    }
  }

  return undefined
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // Not JSON is the same verdict as not an answer.
    return undefined
  }
}

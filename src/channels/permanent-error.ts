import { ChannelError } from '@/core/errors'

// A wrapper such as `AnswerUndelivered` is one level deep; the bound only guards a cyclic cause.
const CAUSE_DEPTH_MAX = 4

/** A refusal the platform repeats on every attempt (a malformed request, a blocked bot, a revoked
 *  token): a retry only asks again. A rate limit or a server error is a plain `ChannelError`. */
export class PermanentChannelError extends ChannelError {}

/** Whether `err` is a permanent refusal, or wraps one as its cause. */
export function isPermanentChannelError(err: unknown, depth = 0): boolean {
  if (!(err instanceof Error) || depth >= CAUSE_DEPTH_MAX) {
    return false
  }

  return err instanceof PermanentChannelError || isPermanentChannelError(err.cause, depth + 1)
}

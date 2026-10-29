import { ChannelError } from '@/core/errors'

/** A refusal the platform repeats on every attempt (a malformed request, a blocked bot, a revoked
 *  token): a retry only asks again. A rate limit or a server error is a plain `ChannelError`. */
export class PermanentChannelError extends ChannelError {}

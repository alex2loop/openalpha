import type { InboundInbox, InboxPayload } from '@/channels/types'
import type { ChannelId } from '@/core/channels'
import { ChannelError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

interface AcceptInboundOptions {
  readonly inbox: InboundInbox
  readonly channel: ChannelId
  readonly updateId: string
  readonly payload: InboxPayload
  readonly acceptedAt: number
}

// The produce side of the inbox, shared by every adapter so one write failure means one thing.
// Poll loops let this throw and back off without advancing their offset; a push listener has no
// offset to hold and must catch it at the transport callback.
export async function acceptInbound(options: AcceptInboundOptions): Promise<void> {
  try {
    await options.inbox.accept({
      channel: options.channel,
      updateId: options.updateId,
      payload: JSON.stringify(options.payload),
      acceptedAt: options.acceptedAt,
    })
  } catch (err: unknown) {
    throw new ChannelError(
      'get_updates_failed',
      `${options.channel} inbox accept failed: ${formatErrForLog(err).message}`,
      { cause: err }
    )
  }
}

import type { ChannelId } from '@/core/channels'

/** Where an unattended message is delivered: the channel and the chat inside it. Its own file, not
 *  notice.ts, because every sender speaks it while the notice payload union names each feature that
 *  can send - a leaf the features may read without importing that union back. */
export interface DeliveryAddress {
  readonly channel: ChannelId
  readonly chatId: string
}

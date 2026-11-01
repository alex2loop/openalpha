import { channelId, LOCAL_CHANNEL_ID } from '@/core/channels'

/** The channel the app's requests, sessions and notices carry. */
export const API_CHANNEL = channelId('api')

/** Whether a request raised on this raw bus channel can be answered from the app; the wire `Channel`
 *  folds unknown channels into `api`, so it never answers this. */
export function isApiChannel(channel: string): boolean {
  return channel === API_CHANNEL
}

/** Whether the operator may delete a chat of this channel from the app: the app's own and the
 *  terminal's. A chat app's is the other side's history too, so it stays. */
export function isDeletableChannel(channel: string): boolean {
  return channel === API_CHANNEL || channel === LOCAL_CHANNEL_ID
}

/** The chat id of the app's own alerts; the runtime gives an unaddressed surface notice the same. */
export const APP_CHAT_ID = 'app'
/** Where a push the daemon raised on its own says it came from: the app, no agent behind it. */
export const APP_SOURCE = { channel: 'api', agentId: '' } as const

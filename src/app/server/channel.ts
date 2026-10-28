import { channelId } from '@/core/channels'

/** The channel the app's requests, sessions and notices carry. */
export const API_CHANNEL = channelId('api')

/** Whether a request raised on this raw bus channel can be answered from the app; the wire `Channel`
 *  folds unknown channels into `api`, so it never answers this. */
export function isApiChannel(channel: string): boolean {
  return channel === API_CHANNEL
}

/** The chat id of the app's own alerts; the runtime gives an unaddressed surface notice the same. */
export const APP_CHAT_ID = 'app'
/** Where a push the daemon raised on its own says it came from: the app, no agent behind it. */
export const APP_SOURCE = { channel: 'api', agentId: '' } as const

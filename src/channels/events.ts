import type { ChannelId } from '@/core/channels'

declare module '@/core/events' {
  interface BusEventMap {
    // How a channel's long-running slash workflows learn the chat moved on: they live in a
    // per-channel registry the session-reset owner in `app` cannot reach.
    chat_session_reset: {
      readonly channel: ChannelId
      readonly chatId: string
    }
    // A stranger's chat was sent a pairing code, so an operator surface can offer to approve it
    // without the operator going to a terminal. Emitted once per code, after the chat received it.
    pairing_requested: {
      readonly channel: ChannelId
      readonly chatId: string
      readonly code: string
      readonly expiresAt: number
    }
  }
}

import type { App } from '@/core/container'
import { API_CHANNEL } from '@/app/server/channel'
import { toWireEvent } from '@/app/server/push/notice-event'
import { broadcast } from '@/app/server/ws/socket'

/** Makes the app a place the daemon delivers to, for as long as the api runs. With no app socket
 *  open the delivery answers `unavailable`, and the sender retries as it would for an offline
 *  chat. A notice that went to a chat channel instead is mirrored to the sockets once the channel
 *  accepted it; one addressed here already reached them. Returns the detach. */
export function attachAppSurface(app: App): () => void {
  const detach = app.resolve('noticeSurfaces').attach(API_CHANNEL, {
    deliver: (message) => {
      const event = toWireEvent(message)

      // Nothing to show, and nothing to retry: the notice was taken.
      if (event === undefined) {
        return 'accepted'
      }

      return broadcast(event) > 0 ? 'accepted' : 'unavailable'
    },
  })
  const stopMirror = app.resolve('deliveredNotices')((message, channels) => {
    if (channels.includes(API_CHANNEL)) {
      return
    }

    const event = toWireEvent(message)

    if (event !== undefined) {
      broadcast(event)
    }
  })

  return () => {
    stopMirror()
    detach()
  }
}

import type { WorkerCall, WorkerReply } from '@/app/server/wire/worker'
import type { FeedSocket, FeedSocketDeps } from '@/web/api/socket'

/** The feed in the web edition: the worker is the other end, so there is nothing to connect. The
 *  socket reads `live` at once, forwards the worker's frames, and takes a fresh snapshot each time
 *  the worker says `ready` again after a restart (the language and the model tiers change then). */
export function createWorkerFeedSocket(worker: Worker, deps: FeedSocketDeps): FeedSocket {
  const lifetime = new AbortController()

  worker.addEventListener(
    'message',
    (event: MessageEvent<WorkerReply>) => {
      if (event.data.kind === 'frame') {
        deps.onFrame(event.data.frame)
      } else if (event.data.kind === 'ready') {
        deps.onOpen()
      }
    },
    { signal: lifetime.signal }
  )
  deps.onStatus('live')
  deps.onOpen()

  return {
    send(frame) {
      const call: WorkerCall = { kind: 'frame', frame }

      worker.postMessage(call)

      return true
    },
    retryNow: () => undefined,
    close: () => lifetime.abort(),
  }
}

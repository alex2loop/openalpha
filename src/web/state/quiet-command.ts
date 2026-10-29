import { computed, effect, type ReadonlySignal, signal, untracked } from '@preact/signals'

import { adoptSessionId, frameIdOf, sessionId } from '@/web/state/chat'
import { type ChatServerFrame, onChatFrame, sendFrame } from '@/web/state/feed'
import { connection } from '@/web/state/session'

interface QuietSend {
  /** The command, as the operator would type it. */
  readonly text: string
  /** Given the daemon's answer when it refused the command before running it. */
  readonly onRefused: (message: string) => void
}

// Sent and not yet answered, by the id the daemon's frames carry back.
const pending = signal<ReadonlyMap<string, QuietSend>>(new Map())

/** The quiet commands still on their way or running, as sent. */
export const quietCommands: ReadonlySignal<readonly string[]> = computed(() =>
  [...pending.value.values()].map((held) => held.text)
)

/** Sends a command whose result the page shows where it was asked for: the chat and the session
 *  keep nothing of it. False when the socket is down. */
export function sendQuiet(request: QuietSend): boolean {
  const id = crypto.randomUUID()
  const session = sessionId.value
  const isSent = sendFrame({
    type: 'chat',
    message: request.text,
    id,
    quiet: true,
    ...(session === undefined ? {} : { sessionId: session }),
  })

  if (isSent) {
    pending.value = new Map(pending.value).set(id, request)
  }

  return isSent
}

/** Reads the frames that answer a quiet command. The returned stop is idempotent. */
export function startQuietCommands(): () => void {
  const offs = [
    onChatFrame(receiveFrame),
    // A dropped socket aborts what it ran, so nothing is left waiting for a frame.
    effect(() => {
      if (connection.value.status !== 'live') {
        untracked(() => {
          pending.value = new Map()
        })
      }
    }),
  ]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

function receiveFrame(frame: ChatServerFrame): void {
  const id = frameIdOf(frame)
  const held = id === undefined ? undefined : pending.value.get(id)

  if (id === undefined || held === undefined) {
    return
  }

  if (frame.kind === 'done' && frame.sessionId !== undefined) {
    adoptSessionId(frame.sessionId)
  }

  if (frame.kind === 'error') {
    held.onRefused(frame.message)
  }

  if (frame.kind === 'done' || frame.kind === 'error' || frame.kind === 'dropped') {
    const next = new Map(pending.value)

    next.delete(id)
    pending.value = next
  }
}

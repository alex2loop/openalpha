import type { WireEvent } from '@/app/server/wire/events'
import type { ChatClient, ChatLink } from '@/app/server/ws/runs'
import { API_CHANNEL } from '@/app/server/channel'
import { steerDroppedText } from '@/app/server/ws/frames'
import { abortCommandRuns, dropWaitingCommands, toLaneTag } from '@/app/server/ws/runs'
import { toApprovalWire, WIRE_NORMALIZERS } from '@/app/server/ws/wire-events'
import { sessionId as brandSessionId } from '@/core/ids'

/** Tells one chat client what the bus says that concerns it: approvals, clarifications, budget
 *  warnings, a steer that ended unread, a session reset and a provider fallback. The daemon's socket
 *  and the browser worker both follow the bus this way; the returned function stops it. */
export function followChatBus(link: ChatLink): () => void {
  const offs = [...followNotices(link), ...followSession(link)]

  return () => {
    for (const off of offs) {
      off()
    }
  }
}

// Subscribed one topic at a time on purpose: iterating the union would collapse the payload types
// into their intersection, which no event satisfies.
function followNotices({ sink, client }: ChatLink): readonly (() => void)[] {
  const { bus } = client.services
  const relay = (event: WireEvent): void => {
    sink.send({ type: 'wire_event', ...event })
  }

  return [
    // Every channel's approval is shown; only an API one is `answerable`, since a channel run's
    // approval resolves on its own channel.
    bus.on('approval_requested', (e) => {
      relay(toApprovalWire(e, client.services.locale))
    }),
    bus.on('approval_resolved', (e) => {
      relay(WIRE_NORMALIZERS.approval_resolved(e))
    }),
    bus.on('clarification_requested', (e) => {
      relay(WIRE_NORMALIZERS.clarification_requested(e))
    }),
    bus.on('budget_warning', (e) => {
      relay(WIRE_NORMALIZERS.budget_warning(e))
    }),
    bus.on('pairing_requested', (e) => {
      relay(WIRE_NORMALIZERS.pairing_requested(e))
    }),
    bus.on('provider_fallback', (e) => {
      const ownsRun =
        client.activeRuns.has(e.sessionId) ||
        (e.chatId !== undefined && client.activeRuns.has(brandSessionId(e.chatId)))

      if (e.channel === API_CHANNEL && ownsRun) {
        relay(WIRE_NORMALIZERS.provider_fallback(e))
      }
    }),
  ]
}

function followSession({ sink, client }: ChatLink): readonly (() => void)[] {
  const { bus } = client.services

  return [
    // A steer the run accepted but ended before reading: the operator has to send it again.
    bus.on('steering_dropped', (e) => {
      if (e.channel === API_CHANNEL && client.activeRuns.has(e.sessionId)) {
        const id = client.steerIds.get(e.sessionId)

        client.steerIds.delete(e.sessionId)
        sink.send({
          type: 'chat',
          kind: 'steer_dropped',
          text: steerDroppedText(client.services.locale, e.count),
          ...toLaneTag(id),
        })
      }
    }),
    // `/new` moves the chat to a session of its own: the commands still running for the old one
    // stop, the ones waiting were already dropped by the lane, and every page on it is told to
    // leave it.
    bus.on('chat_session_reset', (e) => {
      if (e.channel === API_CHANNEL) {
        abortCommandRuns(client, brandSessionId(e.chatId))

        if (e.cause === 'new') {
          sink.send({ type: 'chat', kind: 'reset', sessionId: e.chatId })
        }
      }
    }),
  ]
}

/** A client that is gone takes its commands out of the line at once and stops the runs it started;
 *  a cancel never reaches a run another client owns. */
export function closeChatClient(client: ChatClient): void {
  dropWaitingCommands(client)
  client.steerIds.clear()

  for (const [sessionId, controllers] of client.activeRuns) {
    for (const controller of controllers) {
      controller.abort()
    }

    client.services.runControl.abortSession(sessionId, sessionId)
  }
}

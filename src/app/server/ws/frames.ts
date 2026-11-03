import type { ChatBody } from '@/app/server/wire/chat'
import type { ClientFrame } from '@/app/server/wire/socket'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { ChatClient, ChatLink } from '@/app/server/ws/runs'
import type { SessionId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import { API_CHANNEL } from '@/app/server/channel'
import { resolveSessionId, runChat } from '@/app/server/ws/chat'
import { abortClientSession, toLaneTag } from '@/app/server/ws/runs'
import { runSlash } from '@/app/server/ws/slash'
import { toCommandLaneKey } from '@/core/command-lane'
import { bindLocale } from '@/i18n'

/** Every client frame but the handshake: which contract a client speaks is for its transport to
 *  judge. */
type ChatClientFrame = Exclude<ClientFrame, { readonly type: 'hello' }>

/** One frame from a chat client: a message to run, a steer into the running turn, an interrupt, or
 *  a command pulled from the line. The daemon's socket and the browser worker both end up here. */
export async function handleChatFrame(
  frame: ChatClientFrame,
  sink: FrameSink,
  client: ChatClient
): Promise<void> {
  if (frame.type === 'cancel' || frame.type === 'drop') {
    handleControl(frame, client)

    return
  }

  const link: ChatLink = { sink, client }
  const sessionId = resolveSessionId(frame.sessionId)

  if (frame.type === 'steer' && steer(link, sessionId, frame)) {
    return
  }

  const line = frame.message.trim()
  const quiet = frame.type === 'chat' && frame.quiet === true ? { quiet: true as const } : {}
  const request = line.startsWith('/')
    ? await runSlash({ sessionId, line, ...toLaneTag(frame.id), ...quiet }, sink, client)
    : { sessionId, message: frame.message, ...toLaneTag(frame.id) }

  if (request !== null) {
    await runChat(request, sink, client)
  }
}

/** A steer joins the turn already running, at its next turn boundary. A turn that already ended
 *  cannot take it, and it is not run on its own: the client stopped reading that reply, so it is
 *  sent back as dropped. A slash command is never steered; it runs as an ordinary message. */
function steer(link: ChatLink, sessionId: SessionId, frame: ChatBody): boolean {
  const { message, id } = frame
  const { sink, client } = link

  if (message.trim().startsWith('/')) {
    return false
  }

  if (client.services.runControl.steer(sessionId, sessionId, message)) {
    if (id !== undefined) {
      client.steerIds.set(sessionId, id)
    }

    sink.send({ type: 'chat', kind: 'steered', ...toLaneTag(id) })
  } else {
    sink.send({
      type: 'chat',
      kind: 'steer_dropped',
      text: steerDroppedText(client.services.locale, 1),
      ...toLaneTag(id),
    })
  }

  return true
}

/** An interrupt, or a command pulled from the line. The lane rejects the dropped command, and the
 *  client that ran it answers `dropped`. */
function handleControl(
  frame: Extract<ClientFrame, { readonly type: 'cancel' | 'drop' }>,
  client: ChatClient
): void {
  const sessionId = resolveSessionId(frame.sessionId)

  if (frame.type === 'cancel') {
    abortClientSession(client, sessionId)

    return
  }

  client.services.commandLane.drop(toCommandLaneKey(API_CHANNEL, sessionId), frame.id)
}

export function steerDroppedText(locale: Locale, count: number): string {
  const key = count === 1 ? 'channel.steeringDroppedOne' : 'channel.steeringDropped'

  return bindLocale(locale).translate(key, { count })
}

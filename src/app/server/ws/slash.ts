import type { ServerWebSocket } from 'bun'
import { randomUUID } from 'node:crypto'

import type { LaneTag } from '@/app/server/wire/chat'
import type { WsData, WsServices } from '@/app/server/ws/socket'
import type { HelpRequest, SlashDispatcher } from '@/commands/api'
import type { AgentId, SessionId } from '@/core/ids'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { SessionRouteRegistration } from '@/core/types/session'
import { API_CHANNEL } from '@/app/server/channel'
import { resolveAgentId } from '@/app/server/ws/chat'
import {
  registerCommandRun,
  send,
  sendOperatorFailure,
  sendRunError,
  toLaneTag,
  toTurnTag,
  trackLaneItem,
  unregisterSocketRun,
} from '@/app/server/ws/runs'
import { HELP_COMMAND, parseHelpLine, renderCommandHelp, renderMessages } from '@/commands/api'
import { toCommandLaneKey } from '@/core/command-lane'
import { RunHalted } from '@/core/errors'
import { runId as brandRunId, LOCAL_USER_ID } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { bindLocale, t } from '@/i18n'
import { TRADE_COMMAND_NAME } from '@/trading/api'

type ResolvedSlash = ReturnType<SlashDispatcher['resolve']>

interface SlashRun {
  readonly ws: ServerWebSocket<WsData>
  readonly sessionId: SessionId
  readonly line: string
  readonly resolved: ResolvedSlash
  readonly controller: AbortController
  readonly ctx: SlashContext
  readonly longRunning: boolean
  /** Runs beside the session's turn, in the command lane. */
  readonly inLane: boolean
  readonly tag: LaneTag
  /** The client's id for the line, when it sent one. */
  readonly clientId?: string
}

/** A message to run as an agent turn; `id` is the client's id for the message that asked. */
export interface ChatRunRequest extends LaneTag {
  readonly message: string
  readonly agentId?: AgentId
}

/** One slash line and the client's id for it, when the client sent one. */
interface SlashLine extends LaneTag {
  readonly line: string
}

/** Returns the message to run as a turn, or null when the slash command was terminal. */
export async function runSlash(
  ws: ServerWebSocket<WsData>,
  sessionId: SessionId,
  input: SlashLine
): Promise<ChatRunRequest | null> {
  const { line } = input
  const controller = new AbortController()
  const resolved = ws.data.services.slashDispatcher.resolve(line)
  const longRunning = resolved?.policy.execution !== undefined

  if (resolved?.command.name === TRADE_COMMAND_NAME && !ws.data.services.apiOrders) {
    sendOperatorFailure(ws, { key: 'errors.apiOrdersOff' }, toLaneTag(input.id))

    return null
  }

  if (longRunning && !registerCommandRun(ws, sessionId, controller)) {
    return null
  }

  const run = toSlashRun({ ws, sessionId, line, resolved, controller, longRunning }, input.id)
  const help = parseHelpLine(line)

  if (help !== null) {
    sendChat(run, renderHelp(ws.data.services, help))

    return null
  }

  try {
    const result = await execute(run)

    // A null result is a queued command aborted before it started.
    if (controller.signal.aborted || result === null) {
      return endWithoutResult(run)
    }

    return handleSlashResult(run, result)
  } catch (err: unknown) {
    return handleSlashFailure(run, err)
  } finally {
    if (longRunning) {
      unregisterSocketRun(ws, sessionId, controller)
    }
  }
}

// What the terminal's `/help` prints, from the same renderer: the page has no verbs of its own.
function renderHelp(services: WsServices, request: HelpRequest): string {
  const { locale, slashDispatcher } = services

  return renderCommandHelp(bindLocale(locale), {
    controls: [{ verb: HELP_COMMAND, description: t(locale, 'slash.helpHelp') }],
    commands: slashDispatcher.all('repl', 'operator'),
    ...request,
  })
}

// A lane command is tagged with the client's id, else its own; any other line only with the client's.
function toSlashRun(
  input: Omit<SlashRun, 'ctx' | 'tag' | 'inLane' | 'clientId'>,
  clientId: string | undefined
): SlashRun {
  const { ws, sessionId, resolved, controller, longRunning } = input
  const { services } = ws.data
  const requestId = randomUUID()
  const inLane = longRunning && resolved?.policy.selfContained === true
  const tag: LaneTag = inLane ? { id: clientId ?? requestId } : toLaneTag(clientId)
  const ctx: SlashContext = {
    channel: API_CHANNEL,
    requestId,
    surface: 'repl',
    userId: LOCAL_USER_ID,
    sessionId,
    // The app has one chat per session, so the session id is also the chat's identity.
    chatId: sessionId,
    role: 'operator',
    locale: services.locale,
    signal: controller.signal,
    args: [],
    // Named here, before the command starts, so a queued command can tell the client which run
    // it will be; the dispatcher keeps it.
    ...(longRunning ? { runId: brandRunId(randomUUID()) } : {}),
    progress: (key, params) => {
      if (!controller.signal.aborted) {
        send(ws, {
          type: 'chat',
          kind: 'progress',
          text: bindLocale(services.locale).translate(key, params),
          ...tag,
        })
      }
    },
  }

  return { ...input, ctx, tag, inLane, ...(clientId === undefined ? {} : { clientId }) }
}

async function execute(run: SlashRun): Promise<SlashResult | null> {
  const { ws, sessionId, controller, longRunning, tag } = run

  if (run.inLane && tag.id !== undefined) {
    return runInLane(run, tag.id)
  }

  if (!longRunning) {
    return dispatchSlash(run)
  }

  // Held behind the session's turn: a client that tagged the line hears that it waits, and when it
  // begins.
  const hasWaited = run.clientId !== undefined && ws.data.services.sessionQueue.depth(sessionId) > 0

  if (hasWaited) {
    send(ws, { type: 'chat', kind: 'queued', ...toTurnTag(run.clientId, sessionId) })
  }

  return ws.data.services.sessionQueue.enqueue(sessionId, async () => {
    if (controller.signal.aborted) {
      return null
    }

    if (hasWaited && run.clientId !== undefined) {
      send(ws, { type: 'chat', kind: 'started', id: run.clientId, sessionId })
    }

    return dispatchSlash(run)
  })
}

/** A self-contained command runs beside the session's turn. It waits only when the chat already has
 *  as many commands running as the lane allows, and says so while it does. */
async function runInLane(run: SlashRun, id: string): Promise<SlashResult | null> {
  const { ws, sessionId, controller, ctx } = run
  const { services } = ws.data
  const registration = await openLaneRegistration(services, sessionId)

  // The socket may have closed while the route was being opened.
  if (controller.signal.aborted) {
    registration.release()

    return null
  }

  trackLaneItem(ws, controller, id)

  return await services.commandLane.enqueue({
    key: toCommandLaneKey(API_CHANNEL, sessionId),
    id,
    registration,
    onWaiting: (position) => {
      send(ws, { type: 'chat', kind: 'queued', id, position })
    },
    task: async () => {
      if (controller.signal.aborted) {
        return null
      }

      send(ws, {
        type: 'chat',
        kind: 'started',
        id,
        ...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
      })

      return await dispatchSlash(run)
    },
  })
}

/** A lane command that ends without an answer says so: removed while it waited, or cancelled after
 *  it started. Any other command ends quietly, as it always has. */
function endWithoutResult(run: SlashRun): null {
  if (run.tag.id !== undefined) {
    send(run.ws, { type: 'chat', kind: 'dropped', id: run.tag.id })
  }

  return null
}

// The same route the channels hold for a queued command: a `/new` on this chat stales it.
async function openLaneRegistration(
  services: WsServices,
  sessionId: SessionId
): Promise<SessionRouteRegistration> {
  const lease = await services.sessionQueue.acquireRoute({
    channel: API_CHANNEL,
    chatId: sessionId,
    userId: LOCAL_USER_ID,
  })

  try {
    return lease.register()
  } finally {
    lease.release()
  }
}

function handleSlashFailure(run: SlashRun, err: unknown): null {
  const { ws, controller, tag } = run
  const { services } = ws.data

  if (err instanceof RunHalted && err.code === 'queue_full') {
    send(ws, {
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: t(services.locale, 'errors.queueFull'),
      ...tag,
    })

    return null
  }

  if (tag.id === undefined) {
    throw err
  }

  // Told to stop, or rejected by the lane while it waited: the command ended without a result.
  if (controller.signal.aborted || (err instanceof RunHalted && err.code === 'abort')) {
    return endWithoutResult(run)
  }

  services.logger.warn('api.ws_slash_failed', { err: formatErrForLog(err) })
  sendRunError(ws, err, tag.id)

  return null
}

// A command may bill model calls or append its exchange to this session, and both reference the
// row a first agent turn would otherwise create.
async function openSession(services: WsServices, sessionId: SessionId): Promise<void> {
  await services.sessions.create({
    id: sessionId,
    agentId: await resolveAgentId(services, sessionId),
    userId: LOCAL_USER_ID,
    channel: API_CHANNEL,
    chatId: sessionId,
  })
}

async function dispatchSlash(run: SlashRun): ReturnType<SlashDispatcher['dispatch']> {
  const { ws, line, ctx, resolved } = run
  const { services } = ws.data

  if (resolved === null) {
    return services.slashDispatcher.dispatch(line, ctx)
  }

  await openSession(services, ctx.sessionId)

  return services.slashDispatcher.dispatchResolved(resolved, ctx)
}

/** Sends chat frames for a slash result; returns a turn request when one should run. */
function handleSlashResult(run: SlashRun, result: SlashResult): ChatRunRequest | null {
  switch (result.kind) {
    case 'message':
      sendChat(run, renderMessages(bindLocale(run.ws.data.services.locale), result))
      return null
    case 'text':
      sendChat(run, result.text)
      return null
    case 'agent':
      return {
        message: result.retryMessage,
        ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
        ...toLaneTag(run.clientId),
      }
    case 'handled':
      sendSlashDone(run)
      return null
    default: {
      // Exhaustive - unreachable per SlashResult union.
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

function sendChat(run: SlashRun, delta: string): void {
  send(run.ws, { type: 'chat', kind: 'text', delta, ...run.tag })
  sendSlashDone(run)
}

function sendSlashDone(run: SlashRun): void {
  const { ctx } = run

  send(run.ws, {
    type: 'chat',
    kind: 'done',
    reason: 'slash',
    sessionId: run.sessionId,
    ...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
    ...run.tag,
  })
}

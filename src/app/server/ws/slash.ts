import type { LaneTag } from '@/app/server/wire/chat'
import type { FrameSink } from '@/app/server/ws/frame-sink'
import type { ChatClient, ChatLink } from '@/app/server/ws/runs'
import type { WsServices } from '@/app/server/ws/services'
import type { HelpRequest, SlashDispatcher } from '@/commands/api'
import type { AgentId, SessionId } from '@/core/ids'
import type { SlashContext, SlashResult } from '@/core/types/command'
import type { SessionRouteRegistration } from '@/core/types/session'
import { API_CHANNEL } from '@/app/server/channel'
import { resolveAgentId } from '@/app/server/ws/chat'
import {
  type CommandStartWatch,
  registerCommandRun,
  sendOperatorFailure,
  sendRunError,
  toLaneTag,
  toTurnTag,
  trackLaneItem,
  unregisterRun,
  watchCommandStart,
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
  readonly link: ChatLink
  readonly sessionId: SessionId
  readonly line: string
  readonly resolved: ResolvedSlash
  readonly controller: AbortController
  readonly ctx: SlashContext
  readonly longRunning: boolean
  /** Runs beside the session's turn, in the command lane. */
  readonly inLane: boolean
  /** A quiet long-running command; anything else sent quiet runs as typed. */
  readonly isQuiet: boolean
  /** Present on a quiet run: tells a refusal, whose answer comes back, from a run that started. */
  readonly quietStart?: CommandStartWatch
  readonly tag: LaneTag
  /** The client's id for the line, when it sent one. */
  readonly clientId?: string
}

/** A message to run as an agent turn in `sessionId`; `id` is the client's id for the message that
 *  asked. */
export interface ChatRunRequest extends LaneTag {
  readonly sessionId: SessionId
  readonly message: string
  /** The line the operator typed, when `message` is what the command handed the agent for it. */
  readonly typedMessage?: string
  readonly agentId?: AgentId
}

/** One slash line in `sessionId` and the client's id for it, when the client sent one. */
interface SlashLine extends LaneTag {
  readonly sessionId: SessionId
  readonly line: string
  readonly quiet?: true
}

/** Returns the message to run as a turn, or null when the slash command was terminal. */
export async function runSlash(
  input: SlashLine,
  sink: FrameSink,
  client: ChatClient
): Promise<ChatRunRequest | null> {
  const { line, sessionId } = input
  const link: ChatLink = { sink, client }
  const controller = new AbortController()
  const resolved = client.services.slashDispatcher.resolve(line)
  const longRunning = resolved?.policy.execution !== undefined

  if (resolved?.command.name === TRADE_COMMAND_NAME && !client.services.apiOrders) {
    sendOperatorFailure(link, { key: 'errors.apiOrdersOff' }, toLaneTag(input.id))

    return null
  }

  if (longRunning && !registerCommandRun(link, sessionId, controller)) {
    return null
  }

  const isQuiet = input.quiet === true && longRunning
  const base = toSlashRun(
    { link, sessionId, line, resolved, controller, longRunning, isQuiet },
    input.id
  )
  const help = parseHelpLine(line)

  if (help !== null) {
    sendChat(base, renderHelp(client.services, help))

    return null
  }

  const run: SlashRun =
    isQuiet && base.ctx.runId !== undefined
      ? { ...base, quietStart: watchCommandStart(client.services.bus, base.ctx.runId) }
      : base

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
    run.quietStart?.stop()

    if (longRunning) {
      unregisterRun(client, sessionId, controller)
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
  input: Omit<SlashRun, 'ctx' | 'tag' | 'inLane' | 'clientId' | 'quietStart'>,
  clientId: string | undefined
): SlashRun {
  const { link, sessionId, resolved, controller, longRunning, isQuiet } = input
  const { services } = link.client
  const requestId = crypto.randomUUID()
  const inLane = longRunning && resolved?.policy.selfContained === true
  const tag: LaneTag = inLane ? { id: clientId ?? requestId } : toLaneTag(clientId)
  const ctx: SlashContext = {
    channel: API_CHANNEL,
    requestId,
    surface: 'repl',
    readsAs: 'channel',
    hasAiLabel: true,
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
    ...(longRunning ? { runId: brandRunId(crypto.randomUUID()) } : {}),
    ...(isQuiet ? { isQuiet: true } : {}),
    progress: (key, params) => {
      if (!controller.signal.aborted) {
        link.sink.send({
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
  const { link, sessionId, controller, longRunning, tag } = run
  const { services } = link.client

  if (run.inLane && tag.id !== undefined) {
    return runInLane(run, tag.id)
  }

  if (!longRunning) {
    return dispatchSlash(run)
  }

  // Held behind the session's turn: a client that tagged the line hears that it waits, and when it
  // begins.
  const hasWaited = run.clientId !== undefined && services.sessionQueue.depth(sessionId) > 0

  if (hasWaited) {
    link.sink.send({ type: 'chat', kind: 'queued', ...toTurnTag(run.clientId, sessionId) })
  }

  return services.sessionQueue.enqueue(sessionId, async () => {
    if (controller.signal.aborted) {
      return null
    }

    if (hasWaited && run.clientId !== undefined) {
      link.sink.send({ type: 'chat', kind: 'started', id: run.clientId, sessionId })
    }

    return dispatchSlash(run)
  })
}

/** A self-contained command runs beside the session's turn. It waits only when the chat already has
 *  as many commands running as the lane allows, and says so while it does. */
async function runInLane(run: SlashRun, id: string): Promise<SlashResult | null> {
  const { link, sessionId, controller, ctx } = run
  const { services } = link.client
  const registration = await openLaneRegistration(services, sessionId)

  // The socket may have closed while the route was being opened.
  if (controller.signal.aborted) {
    registration.release()

    return null
  }

  trackLaneItem(link.client, controller, id)

  return await services.commandLane.enqueue({
    key: toCommandLaneKey(API_CHANNEL, sessionId),
    id,
    registration,
    onWaiting: (position) => {
      link.sink.send({ type: 'chat', kind: 'queued', id, position })
    },
    task: async () => {
      if (controller.signal.aborted) {
        return null
      }

      link.sink.send({
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
    run.link.sink.send({ type: 'chat', kind: 'dropped', id: run.tag.id })
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
  const { link, controller, tag } = run
  const { services } = link.client

  if (err instanceof RunHalted && err.code === 'queue_full') {
    link.sink.send({
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
  sendRunError(link, err, tag.id)

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
  const { link, line, ctx, resolved } = run
  const { services } = link.client

  await openSession(services, ctx.sessionId)

  if (resolved === null) {
    return services.slashDispatcher.dispatch(line, ctx)
  }

  return services.slashDispatcher.dispatchResolved(resolved, ctx)
}

/** Sends chat frames for a slash result; returns a turn request when one should run. */
function handleSlashResult(run: SlashRun, result: SlashResult): ChatRunRequest | null {
  switch (result.kind) {
    case 'message':
      sendAnswer(run, renderMessages(bindLocale(run.link.client.services.locale), result))
      return null
    case 'text':
      sendAnswer(run, result.text)
      return null
    case 'agent':
      if (run.isQuiet) {
        sendSlashDone(run)
        return null
      }

      return {
        sessionId: run.sessionId,
        message: result.retryMessage,
        typedMessage: run.line,
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

// A quiet command's result is shown where it was asked for, so only a refusal comes back: it ran
// nothing there, and its answer is the only word of why.
function sendAnswer(run: SlashRun, text: string): void {
  if (run.quietStart === undefined) {
    sendChat(run, text)
  } else if (run.quietStart.hasStarted()) {
    sendSlashDone(run)
  } else {
    run.link.sink.send({
      type: 'chat',
      kind: 'error',
      code: 'unavailable',
      message: text,
      ...run.tag,
    })
  }
}

function sendChat(run: SlashRun, delta: string): void {
  run.link.sink.send({ type: 'chat', kind: 'text', delta, ...run.tag })
  sendSlashDone(run)
}

function sendSlashDone(run: SlashRun): void {
  const { ctx } = run

  run.link.sink.send({
    type: 'chat',
    kind: 'done',
    reason: 'slash',
    sessionId: run.sessionId,
    ...(ctx.runId === undefined ? {} : { runId: ctx.runId }),
    ...run.tag,
  })
}

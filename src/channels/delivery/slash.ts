import { randomUUID } from 'node:crypto'

import type { InboundHandlerDeps } from '@/channels/delivery/types'
import type { InboundMessage, OutboundButton } from '@/channels/types'
import type { HelpRequest, ResolvedSlashCommand } from '@/commands/api'
import type { AgentId, RunId, SessionId } from '@/core/ids'
import type {
  Affordance,
  CommandRole,
  CommandSurface,
  LongRunningExecution,
  SlashContext,
} from '@/core/types/command'
import type { SessionRouteLease } from '@/core/types/session'
import { TELEGRAM_CALLBACK_DATA_MAX_BYTES } from '@/channels/adapters/telegram/protocol'
import { buildAbortCallbackData, COMMAND_CALLBACK_ACTION } from '@/channels/delivery/callbacks'
import { channelControlHelp } from '@/channels/delivery/control'
import { formatChannelFooter, joinFooter } from '@/channels/delivery/format'
import { runInCommandLane } from '@/channels/delivery/slash-lane'
import { openSlashNotice, type SlashNotice } from '@/channels/delivery/slash-notice'
import { operatorContextOf } from '@/channels/operator'
import { parseHelpLine, renderCommandHelp, renderMessages } from '@/commands/api'
import { BRAND } from '@/core/brand'
import {
  abortError,
  ChannelError,
  isAbortError,
  isCallerFault,
  operatorMessageOf,
  RunHalted,
  ToolError,
} from '@/core/errors'
import { runId as brandRunId, userId as brandUserId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { hasRunFooter } from '@/core/utils/footer'
import { bindLocale, t } from '@/i18n'

const CHANNEL_COMMAND_SURFACE: CommandSurface = 'channel'

export interface SlashRunRequest {
  readonly text: string
  readonly agentId?: AgentId
}

interface ResolveSlashOptions {
  readonly deps: InboundHandlerDeps
  readonly msg: InboundMessage
  readonly sessionId: SessionId
  readonly route: SessionRouteLease
  readonly resolveAgentId: (chatId: string) => Promise<AgentId>
  readonly resolved?: ResolvedSlashCommand
}

interface DispatchSlashOptions {
  readonly deps: InboundHandlerDeps
  readonly msg: InboundMessage
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  readonly resolveAgentId: (chatId: string) => Promise<AgentId>
  readonly resolved?: ResolvedSlashCommand
  /** Present only for a long-running command, which reports its steps through it. */
  readonly notice?: SlashNotice
  /** Minted by the surface for a long-running command, so its end can be told from the bus. */
  readonly runId?: RunId
}

/** A command that fails has still been processed: the inbox must not re-run a twenty-six section
 *  build because the answer never arrived, and the operator must not be left with a progress notice
 *  that simply stops. Abort still propagates — that is shutdown reclaiming the entry. */
export async function resolveSlashRunRequest(
  options: ResolveSlashOptions
): Promise<SlashRunRequest | null> {
  const { deps, msg } = options

  try {
    return await runSlashRequest(options)
  } catch (err: unknown) {
    if (deps.signal.aborted || isAbortError(err)) {
      throw err
    }

    deps.logger.error('channel.slash_failed', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
    await reportFailure(deps, msg.chatId, err)

    return null
  }
}

/** Best-effort: a channel that cannot deliver the apology must not mask the failure that caused
 *  it, nor turn one failed command into a redelivered one. */
async function reportFailure(
  deps: InboundHandlerDeps,
  chatId: string,
  failure: unknown
): Promise<void> {
  try {
    await deps.sendText(chatId, failureText(deps, failure))
  } catch (err: unknown) {
    deps.logger.warn('channel.slash_failure_unreported', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })
  }
}

/** Three outcomes, all in the operator's language: a message written for them, a refusal they can
 *  act on, or a transient failure worth retrying. The detail is in `channel.slash_failed`, which
 *  carries this invocation's correlation id. */
function failureText(deps: InboundHandlerDeps, err: unknown): string {
  const operator = operatorMessageOf(err)

  if (operator !== undefined) {
    return bindLocale(deps.locale).translate(operator.key, operator.params)
  }

  const key = isCallerFault(err) ? 'channel.commandRejected' : 'channel.commandFailed'

  return t(deps.locale, key, { brand: BRAND.name })
}

async function runSlashRequest(options: ResolveSlashOptions): Promise<SlashRunRequest | null> {
  const { deps, msg, sessionId } = options

  const help = parseHelpLine(msg.text)

  if (help !== null) {
    await deps.sendText(msg.chatId, helpText(deps, roleOf(deps, msg), help))
    return null
  }

  const resolved = deps.dispatcher.resolve(msg.text)

  if (resolved?.policy.execution !== undefined) {
    await runLongRunningSlash({ ...options, resolved })
    return null
  }

  return dispatchSlash({
    deps,
    msg,
    sessionId,
    signal: deps.signal,
    resolveAgentId: options.resolveAgentId,
    ...(resolved === null ? {} : { resolved }),
  })
}

async function runLongRunningSlash(options: ResolveSlashOptions): Promise<void> {
  const { deps, msg, sessionId, resolved } = options

  if (resolved === undefined) {
    throw new ChannelError('get_updates_failed', 'missing resolved long-running slash command')
  }

  const controller = deps.slashRuns.register(sessionId, msg.chatId)

  try {
    await enqueueSlash(options, controller)
  } catch (err: unknown) {
    if (!(err instanceof RunHalted && err.code === 'queue_full')) {
      throw err
    }

    await deps.sendText(msg.chatId, t(deps.locale, 'channel.queueFull'))
  } finally {
    deps.slashRuns.unregister(sessionId, msg.chatId, controller)
  }
}

/** A self-contained command runs in the chat's lane; any other waits its turn in the session's. */
function enqueueSlash(options: ResolveSlashOptions, controller: AbortController): Promise<void> {
  const { deps, msg, sessionId, route, resolved } = options
  const task = (): Promise<void> => runQueuedSlash(options, controller)

  if (resolved?.policy.selfContained === true) {
    return runInCommandLane({ deps, chatId: msg.chatId, id: requestIdOf(msg), route, task })
  }

  const queued = deps.sessionQueue.enqueue(sessionId, task, route.register())

  route.release()

  return queued
}

/** The command's turn at the head of its session. The notice opens here, not when the request
 *  arrives: a command waiting behind another says nothing until it starts, and its reveal delay is
 *  measured from its own start. Whatever the command does, the notice is stopped in this task. */
async function runQueuedSlash(
  options: ResolveSlashOptions,
  controller: AbortController
): Promise<void> {
  const { deps, msg, sessionId, resolveAgentId, resolved } = options

  if (controller.signal.aborted) {
    return
  }

  const stop = watchStopped(deps, controller.signal)
  let notice: SlashNotice | null = null

  try {
    notice = openProgressNotice({
      deps,
      msg,
      sessionId,
      signal: stop.signal,
      execution: resolved?.policy.execution,
    })

    const request = await dispatchSlash({
      deps,
      msg,
      sessionId,
      signal: controller.signal,
      resolveAgentId,
      runId: stop.runId,
      ...(resolved === undefined ? {} : { resolved }),
      ...(notice === null ? {} : { notice }),
    })

    if (request === null) {
      return
    }

    // Outside the session's queue, an agent turn would race the session's own.
    if (resolved?.policy.selfContained === true) {
      throw new ToolError('unexpected', 'self-contained command asked for an agent turn')
    }

    const selectedAgent = request.agentId ?? (await resolveAgentId(msg.chatId))
    await deps.runExchange({
      combined: { ...msg, text: request.text },
      sessionId,
      agentId: selectedAgent,
    })
  } finally {
    stop.off()
    await notice?.stop()
  }
}

interface StopWatch {
  readonly runId: RunId
  /** Fires when the surface's own signal does, or when the command ends as stopped. */
  readonly signal: AbortSignal
  off(): void
}

// A stop by run id (the app's Stop) aborts the dispatcher's child controller, never the surface's
// signal, so the command's own end event is what tells the notice it was cancelled.
function watchStopped(deps: InboundHandlerDeps, own: AbortSignal): StopWatch {
  const id = brandRunId(randomUUID())
  const stopped = new AbortController()
  const off = deps.bus.on('command_finished', (e) => {
    if (e.runId === id && e.outcome === 'aborted') {
      stopped.abort()
    }
  })

  return { runId: id, signal: AbortSignal.any([own, stopped.signal]), off }
}

interface OpenNoticeInput {
  readonly deps: InboundHandlerDeps
  readonly msg: InboundMessage
  readonly sessionId: SessionId
  readonly signal: AbortSignal
  readonly execution: LongRunningExecution | undefined
}

function openProgressNotice(input: OpenNoticeInput): SlashNotice | null {
  const { deps, msg, execution } = input

  if (execution === undefined) {
    return null
  }

  return openSlashNotice(
    {
      adapter: deps.adapter,
      settings: deps.settings,
      logger: deps.logger,
      locale: deps.locale,
      chatId: msg.chatId,
      replyToMessageId: msg.messageId,
      signal: input.signal,
      cancelData: buildAbortCallbackData(input.sessionId),
    },
    execution.progressKey
  )
}

async function dispatchSlash(options: DispatchSlashOptions): Promise<SlashRunRequest | null> {
  const { deps, msg, signal, resolved } = options

  if (signal.aborted) {
    throw abortError(signal)
  }

  const role = roleOf(deps, msg)
  const ctx = buildSlashContext(options, role)

  await openChatSession(options, ctx)

  const startedAt = performance.now()
  const result =
    resolved === undefined
      ? await deps.dispatcher.dispatch(msg.text, ctx)
      : await deps.dispatcher.dispatchResolved(resolved, ctx)
  const elapsedMs = Math.round(performance.now() - startedAt)

  // Before anything is sent, or the reveal timer paints the notice under the answer.
  await options.notice?.stop()

  if (result === null) {
    return { text: msg.text }
  }

  switch (result.kind) {
    case 'message':
      await deps.sendText(msg.chatId, renderMessages(bindLocale(deps.locale), result))
      return null
    case 'text': {
      const footer = hasRunFooter(resolved?.policy, result)
        ? await sessionFooter(deps, ctx.sessionId, elapsedMs)
        : null
      const offered = offeredNext(deps, result.affordances ?? [])
      const body = footer === null ? result.text : joinFooter(result.text, footer)

      await deps.sendText(msg.chatId, joinLines(body, offered.lines), offered.buttons)
      return null
    }
    case 'agent':
      return {
        text: result.retryMessage,
        ...(result.agentId === undefined ? {} : { agentId: result.agentId }),
      }
    case 'handled':
      return null
    default: {
      // Exhaustive — unreachable per SlashResult union.
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

/** What the reader could run next, rendered the way the destination can carry it: a keyboard where
 *  the channel has one, lines they can type where it does not. Nothing exists only as a button, so
 *  a payload too large for the wire degrades to a line rather than disappearing. */
function offeredNext(
  deps: InboundHandlerDeps,
  affordances: readonly Affordance[]
): { readonly buttons: readonly OutboundButton[]; readonly lines: readonly string[] } {
  const buttons: OutboundButton[] = []
  const lines: string[] = []

  for (const affordance of affordances) {
    const callbackId = `${COMMAND_CALLBACK_ACTION}${affordance.command}`

    if (deps.adapter.capabilities.inlineButtons && fitsCallbackData(callbackId)) {
      buttons.push({ label: labelOf(affordance), callbackId })
      continue
    }

    lines.push(
      t(deps.locale, 'channel.affordanceLine', {
        label: labelOf(affordance),
        command: affordance.command,
      })
    )
  }

  return { buttons, lines }
}

function labelOf(affordance: Affordance): string {
  return affordance.icon === undefined ? affordance.label : `${affordance.icon} ${affordance.label}`
}

function fitsCallbackData(callbackId: string): boolean {
  return new TextEncoder().encode(callbackId).length <= TELEGRAM_CALLBACK_DATA_MAX_BYTES
}

function joinLines(body: string, lines: readonly string[]): string {
  return lines.length === 0 ? body : [body, '', ...lines].join('\n')
}

/** The answer matters more than the footer, so an unreadable ledger sends the body bare. */
async function sessionFooter(
  deps: InboundHandlerDeps,
  id: SessionId,
  elapsedMs: number
): Promise<string | null> {
  try {
    const totals = await deps.spend.forSession(id)

    return formatChannelFooter(deps.locale, totals, { elapsedMs })
  } catch (err: unknown) {
    deps.logger.warn('channel.slash_footer_unavailable', {
      channel: deps.channelId,
      err: formatErrForLog(err),
    })

    return null
  }
}

async function openChatSession(options: DispatchSlashOptions, ctx: SlashContext): Promise<void> {
  const { deps, msg } = options

  await deps.sessions.create({
    id: ctx.sessionId,
    agentId: await options.resolveAgentId(msg.chatId),
    userId: brandUserId(msg.userId),
    channel: deps.channelId,
    chatId: msg.chatId,
  })
}

function helpText(deps: InboundHandlerDeps, role: CommandRole, request: HelpRequest): string {
  return renderCommandHelp(bindLocale(deps.locale), {
    controls: channelControlHelp(deps.locale),
    commands: deps.dispatcher.all(CHANNEL_COMMAND_SURFACE, role),
    ...request,
  })
}

export function roleOf(deps: InboundHandlerDeps, msg: InboundMessage): CommandRole {
  const context = operatorContextOf(msg.isGroup, msg.chatId)
  return deps.gate.isOperatorUser(msg.userId, context) ? 'operator' : 'member'
}

// Derived from the durable inbox payload, never minted per dispatch: an inbox retry after a failed
// acknowledgement must reach the idempotency gates with the key its first attempt used. A tap adds
// its callback query id, which Telegram keeps across redelivery, so a second tap of the same
// keyboard is a new request.
function buildSlashContext(options: DispatchSlashOptions, role: CommandRole): SlashContext {
  const { deps, msg } = options

  return {
    channel: deps.channelId,
    requestId: requestIdOf(msg),
    surface: CHANNEL_COMMAND_SURFACE,
    userId: brandUserId(msg.userId),
    sessionId: options.sessionId,
    chatId: msg.chatId,
    role,
    locale: deps.locale,
    signal: options.signal,
    args: [],
    ...(options.runId === undefined ? {} : { runId: options.runId }),
    ...(options.notice === undefined ? {} : { progress: options.notice.report }),
  }
}

function requestIdOf(msg: InboundMessage): string {
  const key = `${msg.channel}:${msg.chatId}:${msg.messageId}`

  return msg.tapId === undefined ? key : `${key}:${msg.tapId}`
}

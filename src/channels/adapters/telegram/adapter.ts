import type {
  AdapterHandlers,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelOutbound,
  EditRequest,
  InboundInbox,
  ReactionRequest,
  SentRef,
} from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import type { PollOffsetStore } from '@/core/types/session'
import { toTokenMissingError, toTokenRejectedError } from '@/channels/token-errors'
import { ChannelError, ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'
import { sleep } from '@/core/utils/time'

import type { BotIdentity } from './protocol'
import {
  editMessage,
  getMe,
  sendChatAction,
  sendMessage,
  setMessageReaction,
  type TelegramApiContext,
  telegramErrorStatus,
} from './client'
import { TELEGRAM_CHANNEL_ID } from './config'
import { publishCommandMenu } from './menu'
import { runPollLoop } from './poll'
import { TELEGRAM_MAX_LEN } from './protocol'
import { telegramMarkdownV2Renderer } from './renderer'

const UNAUTHORIZED_STATUS = 401
const FORBIDDEN_STATUS = 403
const TELEGRAM_TOKEN_OWNER = { id: TELEGRAM_CHANNEL_ID, label: 'Telegram' } as const
const TELEGRAM_POLL_RESTART_INITIAL_MS = 1_000
const TELEGRAM_POLL_RESTART_MAX_MS = 60_000

const TELEGRAM_CAPABILITIES: ChannelCapabilities = {
  inlineButtons: true,
  markdown: 'markdownv2',
  typing: true,
  reactions: true,
  canEdit: true,
  maxTextLen: TELEGRAM_MAX_LEN,
}

interface CreateTelegramAdapterOptions {
  readonly token: string
  readonly tokenEnv?: string
  readonly pollOffsets: PollOffsetStore
  readonly inbox: InboundInbox
  readonly logger: Logger
  readonly fetchImpl?: typeof fetch
}

export function createTelegramAdapter(options: CreateTelegramAdapterOptions): ChannelAdapter {
  let api: TelegramApiContext | null = null
  let pollTask: Promise<void> | null = null

  function requireApi(): TelegramApiContext {
    if (!api) {
      throw new ChannelError('not_initialized', 'telegram adapter used before start()')
    }

    return api
  }

  return {
    id: TELEGRAM_CHANNEL_ID,
    capabilities: TELEGRAM_CAPABILITIES,
    renderer: telegramMarkdownV2Renderer,

    async start(handlers: AdapterHandlers, signal: AbortSignal): Promise<void> {
      const ctx = buildApiContext(options, signal)
      const botIdentity = await connectOrDefer(ctx, handlers)
      api = ctx

      // Detached: the loop stops on `signal`, so start() resolves after one getMe, answered or not
      // (the loop then fetches the identity again if it is still unknown, and installs the menu).
      pollTask = runRestartLoop({
        api: ctx,
        handlers,
        pollOffsets: options.pollOffsets,
        inbox: options.inbox,
        botIdentity,
        signal,
        logger: options.logger,
      })

      // Only `dispose` awaits it, so a loop that dies first would be a fatal unhandled rejection.
      pollTask.catch((err: unknown) => {
        options.logger.error('telegram.poll_loop_terminated', { err: formatErrForLog(err) })
        handlers.setStatus({ running: false, connected: false, lastError: 'poll_loop_terminated' })
      })
    },

    async send(
      out: ChannelOutbound,
      sendOpts?: { readonly signal?: AbortSignal }
    ): Promise<SentRef> {
      return sendMessage(requireApi(), out, sendOpts)
    },

    async dispose(): Promise<void> {
      api = null

      if (pollTask !== null) {
        await pollTask
      }
    },

    async edit(req: EditRequest): Promise<void> {
      await editMessage(requireApi(), req)
    },

    async chatAction(chatId: string, action: 'typing'): Promise<void> {
      await sendChatAction(requireApi(), chatId, action)
    },

    async setReaction(req: ReactionRequest): Promise<void> {
      await setMessageReaction(requireApi(), req)
    },
  }
}

function buildApiContext(
  options: CreateTelegramAdapterOptions,
  signal: AbortSignal
): TelegramApiContext {
  if (!options.token) {
    throw toTokenMissingError(TELEGRAM_TOKEN_OWNER, options.tokenEnv)
  }

  return {
    botToken: options.token,
    fetchImpl: options.fetchImpl ?? fetch,
    intakeSignal: signal,
    logger: options.logger,
  }
}

// Best-effort menu: setMyCommands logs its own failure, so polling runs either way. Resolves false
// when any scope failed or the menu could not be read, for the loop to try again on its next
// reconnect. `connected` belongs to the poll loop and is not written from here.
async function installMenu(ctx: TelegramApiContext, handlers: AdapterHandlers): Promise<boolean> {
  if (handlers.commandsForMenu === undefined) {
    return true
  }

  try {
    let installed = true

    for (const menu of handlers.commandsForMenu()) {
      installed = (await publishCommandMenu(ctx, menu.audience, menu.commands)) && installed
    }

    return installed
  } catch (err: unknown) {
    ctx.logger.warn('telegram.menu_install_failed', { err: formatErrForLog(err) })

    return false
  }
}

interface MenuInstall {
  installed: boolean
  task: Promise<void> | undefined
}

// Detached from polling: a slow setMyCommands never delays the first getUpdates. One run at a time,
// and none once the menu is in place.
function startMenuInstall(deps: RestartLoopDeps, menu: MenuInstall): void {
  if (menu.installed || menu.task !== undefined) {
    return
  }

  menu.task = installMenu(deps.api, deps.handlers)
    .then((installed) => {
      menu.installed = installed
    })
    .finally(() => {
      menu.task = undefined
    })
}

interface RestartLoopDeps {
  readonly api: TelegramApiContext
  readonly handlers: AdapterHandlers
  readonly pollOffsets: PollOffsetStore
  readonly inbox: InboundInbox
  /** Undefined until getMe has answered; the loop fetches it before its first poll. */
  readonly botIdentity: BotIdentity | undefined
  readonly signal: AbortSignal
  readonly logger: Logger
}

// One bounded outer task: intentional terminations (shutdown, auth threshold, a rejected token)
// resolve cleanly, while unexpected failures, a getMe that could not reach Telegram included,
// restart with capped exponential backoff. The lifecycle signal is the only controller; dispose()
// awaits the same task after it has aborted.
async function runRestartLoop(deps: RestartLoopDeps): Promise<void> {
  const menu: MenuInstall = { installed: false, task: undefined }

  try {
    await runRestartAttempts(deps, menu)
  } finally {
    // Bound by the lifecycle signal, so this settles promptly once the loop is stopping.
    await menu.task
  }
}

/** False when the lifecycle signal ended the wait. */
async function waitBackoff(ms: number, signal: AbortSignal): Promise<boolean> {
  try {
    await sleep(ms, signal)

    return true
  } catch {
    return false
  }
}

async function runRestartAttempts(deps: RestartLoopDeps, menu: MenuInstall): Promise<void> {
  let restartMs = TELEGRAM_POLL_RESTART_INITIAL_MS
  let botIdentity = deps.botIdentity

  // The first getMe just failed, so give Telegram the loop's first backoff step before asking again.
  if (botIdentity === undefined && !(await waitBackoff(restartMs, deps.signal))) {
    return
  }

  while (!deps.signal.aborted) {
    const startedAt = performance.now()

    try {
      // Still unknown when the first getMe could not reach Telegram.
      botIdentity ??= await fetchBotIdentity(deps.api)

      startMenuInstall(deps, menu)

      await runPollLoop({
        api: deps.api,
        handlers: deps.handlers,
        pollOffsets: deps.pollOffsets,
        inbox: deps.inbox,
        botIdentity,
        signal: deps.signal,
      })

      return
    } catch (err: unknown) {
      if (deps.signal.aborted) {
        return
      }

      if (err instanceof ConfigError) {
        deps.logger.error('telegram.token_rejected', { err: formatErrForLog(err) })
        deps.handlers.setStatus({ running: false, connected: false, lastError: 'auth_failed' })

        return
      }

      deps.logger.error('telegram.poll_loop_failed', { err: formatErrForLog(err) })

      restartMs = restartDelayMs(restartMs, startedAt)

      if (!(await waitBackoff(restartMs, deps.signal))) {
        return
      }

      restartMs = Math.min(restartMs * 2, TELEGRAM_POLL_RESTART_MAX_MS)
    }
  }
}

// A loop that ran past the longest backoff was healthy, so its failure starts the ladder over.
function restartDelayMs(restartMs: number, startedAt: number): number {
  return performance.now() - startedAt > TELEGRAM_POLL_RESTART_MAX_MS
    ? TELEGRAM_POLL_RESTART_INITIAL_MS
    : restartMs
}

// The one getMe start() makes decides the channel's fate: a rejected token (ConfigError) keeps it
// from starting, while a network failure leaves the channel up and unconnected for the restart loop
// to keep retrying with its own backoff.
async function connectOrDefer(
  ctx: TelegramApiContext,
  handlers: AdapterHandlers
): Promise<BotIdentity | undefined> {
  try {
    return await fetchBotIdentity(ctx)
  } catch (err: unknown) {
    if (err instanceof ConfigError || ctx.intakeSignal.aborted) {
      throw err
    }

    ctx.logger.warn('telegram.get_me_failed', { err: formatErrForLog(err) })
    handlers.setStatus({ connected: false, lastError: 'get_me_failed' })

    return undefined
  }
}

// getMe verifies the credential: an auth failure here means the token is bad (a ConfigError). Any
// other failure (network, 5xx, timeout) is thrown as is and not retried here.
async function fetchBotIdentity(ctx: TelegramApiContext): Promise<BotIdentity> {
  try {
    return await getMe(ctx)
  } catch (err: unknown) {
    if (isTokenRejected(err)) {
      throw toTokenRejectedError(TELEGRAM_TOKEN_OWNER, formatErrForLog(err).message)
    }

    throw err
  }
}

function isTokenRejected(err: unknown): boolean {
  const status = telegramErrorStatus(err)

  return status === UNAUTHORIZED_STATUS || status === FORBIDDEN_STATUS
}

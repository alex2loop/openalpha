import type {
  AdapterHandlers,
  ChannelAdapter,
  ChannelCapabilities,
  ChannelOutbound,
  InboundInbox,
  SentRef,
} from '@/channels/types'
import type { Logger } from '@/core/logging/logger'
import { PermanentChannelError } from '@/channels/permanent-error'
import { plainRenderer, stripMarkdown } from '@/channels/renderer'
import { toTokenMissingError, toTokenRejectedError } from '@/channels/token-errors'
import { ChannelError, ConfigError } from '@/core/errors'
import { formatErrForLog } from '@/core/security/credentials'

import { getMe, sendChatAction, sendMessage, ZALO_MAX_LEN, ZALO_UNAUTHORIZED_CODE } from './client'
import { ZALO_CHANNEL_ID } from './config'
import { runZaloPollLoop } from './poll'

const ZALO_CAPABILITIES: ChannelCapabilities = {
  inlineButtons: false,
  markdown: 'none',
  typing: true,
  reactions: false,
  canEdit: false,
  maxTextLen: ZALO_MAX_LEN,
}

const ZALO_TOKEN_OWNER = { id: ZALO_CHANNEL_ID, label: 'Zalo' } as const
const ZALO_RATE_LIMITED_CODE = 429
// Zalo publishes no retry-after hint, so a rate-limited send gets one fixed pause instead of the
// provider-named one telegram gets. reply.ts clamps it and retries the final write only.
const ZALO_RATE_LIMIT_RETRY_MS = 5_000

interface CreateZaloAdapterOptions {
  readonly token: string
  readonly tokenEnv?: string
  readonly inbox: InboundInbox
  readonly logger: Logger
}

export function createZaloAdapter(options: CreateZaloAdapterOptions): ChannelAdapter {
  // The abort signal handed to start() ends intake only: sends outlive it so the final notices of a
  // shutdown still go out, each bounded by its caller's signal and the request deadline. dispose()
  // joins the poll task after abort.
  let pollTask: Promise<void> | undefined

  return {
    id: ZALO_CHANNEL_ID,
    capabilities: ZALO_CAPABILITIES,
    renderer: plainRenderer,

    async start(handlers: AdapterHandlers, signal: AbortSignal): Promise<void> {
      if (!options.token) {
        throw toTokenMissingError(ZALO_TOKEN_OWNER, options.tokenEnv)
      }

      await verifyToken(options, handlers, signal)

      pollTask = runZaloPollLoop({
        token: options.token,
        handlers,
        inbox: options.inbox,
        signal,
        logger: options.logger,
      })

      pollTask.catch((err: unknown) => {
        options.logger.error('zalo.poll_loop_terminated', { err: formatErrForLog(err) })
        handlers.setStatus({ running: false, connected: false, lastError: 'poll_loop_terminated' })
      })
    },

    async send(
      out: ChannelOutbound,
      sendOpts?: { readonly signal?: AbortSignal }
    ): Promise<SentRef> {
      return sendZaloMessage(options.token, out, sendOpts?.signal)
    },

    async chatAction(chatId: string, action: 'typing'): Promise<void> {
      await sendChatAction({
        token: options.token,
        chatId,
        action,
      })
    },

    async dispose(): Promise<void> {
      if (pollTask !== undefined) {
        await pollTask
        pollTask = undefined
      }
    },
  }
}

// One getMe, no retry: a refused token keeps the channel from starting. A network failure leaves the
// channel up and unconnected: the poll loop keeps retrying with its own backoff and reports
// connected on its first good poll.
async function verifyToken(
  options: CreateZaloAdapterOptions,
  handlers: AdapterHandlers,
  signal: AbortSignal
): Promise<void> {
  try {
    await assertZaloTokenAccepted(options.token, signal)
    handlers.setStatus({ connected: true, lastError: null })
  } catch (err: unknown) {
    if (err instanceof ConfigError || signal.aborted) {
      throw err
    }

    options.logger.warn('zalo.get_me_failed', { err: formatErrForLog(err) })
    handlers.setStatus({ connected: false, lastError: 'get_me_failed' })
  }
}

// Only a token Zalo itself refuses is the operator's to fix; a 5xx, a rate limit or a malformed
// reply is transient and left to the poll loop.
async function assertZaloTokenAccepted(token: string, signal: AbortSignal): Promise<void> {
  const me = await getMe({ token, signal })

  if (me.ok && me.result) {
    return
  }

  if (me.error_code === ZALO_UNAUTHORIZED_CODE) {
    throw toTokenRejectedError(ZALO_TOKEN_OWNER, me.description ?? String(me.error_code))
  }

  throw new ChannelError(
    'not_initialized',
    `zalo getMe failed (${me.error_code ?? 'no status'}): ${me.description ?? 'no description'}`
  )
}

async function sendZaloMessage(
  token: string,
  out: ChannelOutbound,
  signal: AbortSignal | undefined
): Promise<SentRef> {
  const res = await sendMessage({
    token,
    chatId: out.chatId,
    text: stripMarkdown(out.text),
    ...(signal === undefined ? {} : { signal }),
  })

  if (!(res.ok && res.result)) {
    throw sendFailure(res.error_code, res.description)
  }

  return { messageId: String(res.result.message_id) }
}

// Rate limiting carries retryAfterMs so the shared 429 path in reply.ts engages for zalo too;
// everything else is a plain failure the caller reports.
function sendFailure(errorCode: number | undefined, description: string | undefined): ChannelError {
  const detail = description ?? String(errorCode ?? 'unknown')

  if (errorCode === ZALO_RATE_LIMITED_CODE) {
    return new ChannelError('send_failed', `zalo_send_rate_limited: ${detail}`, {
      cause: errorCode,
      retryAfterMs: ZALO_RATE_LIMIT_RETRY_MS,
    })
  }

  const message = `zalo_send_failed: ${detail}`

  return errorCode === ZALO_UNAUTHORIZED_CODE
    ? new PermanentChannelError('send_failed', message)
    : new ChannelError('send_failed', message)
}

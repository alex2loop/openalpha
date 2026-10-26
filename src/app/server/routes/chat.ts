import { z } from 'zod'

import type {
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatRecentResponse,
  ChatSessionDeletedWire,
  RespondBody,
} from '@/app/server/wire/chat'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { SessionId } from '@/core/ids'
import type { LLMMessage } from '@/core/llm'
import { API_CHANNEL, isApiChannel } from '@/app/server/channel'
import { CHAT_ID_RE } from '@/app/server/chat-id'
import { ENGINE_DECISION } from '@/app/server/decision'
import { apiError, json } from '@/app/server/http/dispatch'
import { toChatSessionsWire } from '@/app/server/mappers/chat'
import {
  localeOf,
  parseLimit,
  parseOptionalBranded,
  parsePageQuery,
  parsePathId,
  readJsonBody,
} from '@/app/server/routes/params'
import { type ChannelId, channelId } from '@/core/channels'
import { ValidationError } from '@/core/errors'
import { sessionId as brandSessionId, DEFAULT_AGENT_ID } from '@/core/ids'
import { scrubCredentials } from '@/core/security/credentials'
import { bindLocale } from '@/i18n'

async function handleChatRecent(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const sessionId = await ctx.app.resolve('sessionStore').latestIdForChannel(API_CHANNEL)
  const agentId = sessionId === null ? undefined : await resolveBoundAgent(ctx, sessionId)

  return json({
    sessionId,
    ...(agentId === undefined ? {} : { agentId }),
  } satisfies ChatRecentResponse)
}

// The agent the app's chat is bound to, when it is a configured agent other than the assistant.
async function resolveBoundAgent(
  ctx: ApiRouteContext,
  sessionId: string
): Promise<string | undefined> {
  const binding = await ctx.app.resolve('chatBindingStore').get(API_CHANNEL, sessionId)

  if (
    binding === null ||
    binding.agentId === DEFAULT_AGENT_ID ||
    !ctx.app.resolve('agents').has(binding.agentId)
  ) {
    return undefined
  }

  return binding.agentId
}

// A session this app opened is a chat id; any other channel's is a UUID.
const UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const DIGITS_RE = /^\d+$/
const DEFAULT_LIMIT = 30
const SESSION_QUERY_MIN_CHARS = 2
const SESSION_QUERY_MAX_CHARS = 100
const SESSION_LIST_MAX = 100
const SESSION_CHANNELS_MAX = 20

async function handleChatHistory(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(req.url)
  const id = parsePathId(req, parseSessionId)
  const rawLimit = url.searchParams.get('limit')
  const limit =
    rawLimit === null ? DEFAULT_LIMIT : parseLimit(rawLimit, ctx.app.config.loop.sessionMessageCap)

  if (id === null || limit === null) {
    return apiError('invalid_body')
  }

  const before = parseIndex(url.searchParams.get('before'))
  const page = await ctx.app.resolve('sessionStore').loadHistoryPage(id, {
    limit,
    ...(before === undefined ? {} : { before }),
  })

  return json({
    sessionId: id,
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
    messages: page.messages.flatMap(toHistoryMessage),
  } satisfies ChatHistoryResponse)
}

export function parseSessionId(raw: string): SessionId {
  if (!(CHAT_ID_RE.test(raw) || UUID_RE.test(raw))) {
    throw new ValidationError('not a session id')
  }

  return brandSessionId(raw)
}

function parseIndex(value: string | null): number | undefined {
  if (value === null || !DIGITS_RE.test(value)) {
    return undefined
  }

  const index = Number(value)

  return Number.isSafeInteger(index) ? index : undefined
}

// An assistant turn is a block array; only its text blocks are display content (a tool call is not).
function toHistoryMessage(message: LLMMessage): readonly ChatHistoryMessage[] {
  const content =
    typeof message.content === 'string'
      ? message.content.trim()
      : message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('')
          .trim()

  return content === '' ? [] : [{ role: message.role, content: scrubCredentials(content) }]
}

/** The conversations of every channel, or of the ones named, newest first. A search shorter than
 *  two characters would match nearly everything, so it is refused rather than ignored. */
async function handleChatSessions(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const params = new URL(req.url).searchParams
  const page = parsePageQuery(params, {
    defaultLimit: DEFAULT_LIMIT,
    maximumLimit: SESSION_LIST_MAX,
    keyset: true,
  })
  const query = params.get('query')?.trim()
  const channels = parseChannels(params.getAll('channel'))
  const id = parseOptionalBranded(params.get('sessionId'), parseSessionId)

  if (
    page === null ||
    channels === null ||
    id === null ||
    (query !== undefined &&
      (query.length < SESSION_QUERY_MIN_CHARS || query.length > SESSION_QUERY_MAX_CHARS))
  ) {
    return apiError('invalid_body')
  }

  const listings = await ctx.app.resolve('sessionStore').listByChannels({
    ...(channels.length === 0 ? {} : { channels }),
    ...(query === undefined ? {} : { query }),
    ...(page.before === undefined ? {} : { before: page.before }),
    ...(page.beforeId === undefined ? {} : { beforeId: brandSessionId(page.beforeId) }),
    ...(id === undefined ? {} : { id }),
    limit: page.limit,
  })

  return json(toChatSessionsWire(listings, page.limit))
}

/** Deletes an app chat. Another channel's session is refused, and so is one whose turn is running;
 *  an id already gone answers `deleted: false`. */
async function handleChatSessionDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, parseSessionId)

  if (id === null) {
    return apiError('invalid_body')
  }

  const store = ctx.app.resolve('sessionStore')
  const channel = await store.channelOf(id)

  if (channel === undefined) {
    return json({ deleted: false } satisfies ChatSessionDeletedWire)
  }

  const { translate } = bindLocale(localeOf(ctx))

  if (!isApiChannel(channel)) {
    return apiError(
      'conflict',
      translate('errors.chatSessionNotWeb', { channel: channelNameOf(channel) })
    )
  }

  const removal = await store.remove(id)

  if (removal === 'active') {
    return apiError('conflict', translate('errors.chatSessionRunning'))
  }

  return json({ deleted: removal === 'removed' } satisfies ChatSessionDeletedWire)
}

/** `null` when there are too many or any of them is not a channel id (400). */
function parseChannels(raws: readonly string[]): readonly ChannelId[] | null {
  if (raws.length > SESSION_CHANNELS_MAX) {
    return null
  }

  try {
    return raws.map(channelId)
  } catch {
    return null
  }
}

const RESPOND_BODY: z.ZodType<RespondBody> = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['approve', 'deny', 'always']),
})

async function handleRespond(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = RESPOND_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const body = parsed.data
  const origin = ctx.live.pendingOrigin(body.requestId)

  // The gate only takes an answer from the channel that asked, so an answer from here would be
  // dropped without a word; say where it has to be given instead.
  if (origin !== undefined && !isApiChannel(origin)) {
    return apiError(
      'conflict',
      bindLocale(localeOf(ctx)).translate('errors.approvalOtherChannel', {
        channel: channelNameOf(origin),
      })
    )
  }

  ctx.app.resolve('bus').emit('approval_resolved', {
    requestId: body.requestId,
    decision: ENGINE_DECISION[body.decision],
    approvedBy: 'api',
    channel: API_CHANNEL,
  })

  return json({ ok: true })
}

// The channel's own name where the catalog has one, else its raw id.
export function channelNameOf(channel: string): {
  readonly key: string
  readonly fallback: string
} {
  return { key: `ui.channelName.${channel}`, fallback: channel }
}

export const CHAT_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/respond', auth: true, handler: handleRespond },
  { method: 'GET', path: '/v1/chat/recent', auth: true, handler: handleChatRecent },
  { method: 'GET', path: '/v1/chat/sessions', auth: true, handler: handleChatSessions },
  {
    method: 'DELETE',
    path: '/v1/chat/sessions/:id',
    auth: true,
    handler: handleChatSessionDelete,
  },
  { method: 'GET', path: '/v1/chat/history/:sessionId', auth: true, handler: handleChatHistory },
]

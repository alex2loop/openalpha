import { z } from 'zod'

import type {
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatRecentResponse,
  RespondBody,
} from '@/app/server/wire/chat'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { LLMMessage } from '@/core/llm'
import { API_CHANNEL, isApiChannel } from '@/app/server/channel'
import { ENGINE_DECISION } from '@/app/server/decision'
import { apiError, json } from '@/app/server/http/dispatch'
import { localeOf, parseLimit } from '@/app/server/routes/params'
import { sessionId as brandSessionId } from '@/core/ids'
import { t } from '@/i18n'

async function handleChatRecent(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const sessionId = await ctx.app.resolve('sessionStore').latestIdForChannel(API_CHANNEL)

  return json({ sessionId } satisfies ChatRecentResponse)
}

const SESSION_ID_RE = /^chat_[0-9a-f]{26}$/
const DIGITS_RE = /^\d+$/
const DEFAULT_LIMIT = 30

async function handleChatHistory(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(req.url)
  const raw = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
  const rawLimit = url.searchParams.get('limit')
  const limit =
    rawLimit === null ? DEFAULT_LIMIT : parseLimit(rawLimit, ctx.app.config.loop.sessionMessageCap)

  if (!SESSION_ID_RE.test(raw) || limit === null) {
    return apiError('invalid_body')
  }

  const before = parseIndex(url.searchParams.get('before'))
  const page = await ctx.app.resolve('sessionStore').loadHistoryPage(brandSessionId(raw), {
    limit,
    ...(before === undefined ? {} : { before }),
  })

  return json({
    sessionId: raw,
    hasMore: page.hasMore,
    nextBefore: page.nextBefore,
    messages: page.messages.flatMap(toHistoryMessage),
  } satisfies ChatHistoryResponse)
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

  return content === '' ? [] : [{ role: message.role, content }]
}

const RESPOND_BODY: z.ZodType<RespondBody> = z.object({
  requestId: z.string().min(1),
  decision: z.enum(['approve', 'deny', 'always']),
})

async function handleRespond(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = RESPOND_BODY.safeParse(await req.json().catch(() => null))

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
      t(localeOf(ctx), 'errors.approvalOtherChannel', { channel: origin })
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

export const CHAT_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/respond', auth: true, handler: handleRespond },
  { method: 'GET', path: '/v1/chat/recent', auth: true, handler: handleChatRecent },
  { method: 'GET', path: '/v1/chat/history/:sessionId', auth: true, handler: handleChatHistory },
]

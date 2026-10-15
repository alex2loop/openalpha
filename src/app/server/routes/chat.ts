import { z } from 'zod'

import type {
  ChatHistoryMessage,
  ChatHistoryResponse,
  ChatRecentResponse,
  RespondBody,
} from '@/app/server/wire/chat'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { LLMMessage } from '@/core/llm'
import { API_CHANNEL } from '@/app/server/channel'
import { ENGINE_DECISION } from '@/app/server/decision'
import { apiError, json } from '@/app/server/http/dispatch'
import { sessionId as brandSessionId } from '@/core/ids'

async function handleChatRecent(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  const sessionId = await ctx.app.resolve('sessionStore').latestIdForChannel(API_CHANNEL)

  return json({ sessionId } satisfies ChatRecentResponse)
}

const SESSION_ID_RE = /^chat_[0-9a-f]{26}$/
const DIGITS_RE = /^\d+$/
const DEFAULT_LIMIT = 30

// The transcript is capped at the session message cap, so the page is cut in memory rather
// than pushed into SQL: there is no unbounded scan to guard against here.
async function handleChatHistory(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const url = new URL(req.url)
  const raw = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)

  if (!SESSION_ID_RE.test(raw)) {
    return apiError('invalid_body')
  }

  const messages = await ctx.app.resolve('sessionStore').loadHistory(brandSessionId(raw))
  const all = messages.filter((m) => m.role === 'user' || m.role === 'assistant')

  const before = Math.min(parseIndex(url.searchParams.get('before')) ?? all.length, all.length)
  const limit = parseIndex(url.searchParams.get('limit')) ?? DEFAULT_LIMIT
  const start = Math.max(0, before - limit)
  const page = all.slice(start, before)

  return json({
    sessionId: raw,
    hasMore: start > 0,
    nextBefore: start > 0 ? start : null,
    messages: page.flatMap(toHistoryMessage),
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

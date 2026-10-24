import { z } from 'zod'

import type { BoardResponse, NoticesReadResponse, NoticesResponse } from '@/app/server/wire/notices'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import '@/app/events'
import { apiError, json } from '@/app/server/http/dispatch'
import { STOP_BREACHED_KIND, toNoticeWire } from '@/app/server/mappers/notices'
import { parseEpochMs, parseLimit, readJsonBody } from '@/app/server/routes/params'

const NOTICES_PAGE_LIMIT = 200
const MAX_READ_IDS = 500
const READ_BODY = z.object({ ids: z.array(z.string().min(1)).max(MAX_READ_IDS).exactOptional() })

/** `before` is epoch ms, the `createdAt` of the last notice a page showed. */
async function handleNotices(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const rawBefore = query.get('before')
  const limit = parseLimit(query.get('limit'), NOTICES_PAGE_LIMIT)
  const before = rawBefore === null ? undefined : parseEpochMs(rawBefore)

  if (limit === null || before === null) {
    return apiError('invalid_body')
  }

  const store = ctx.app.resolve('noticeStore')
  const [rows, unread, stops] = await Promise.all([
    store.list(before, limit),
    store.unreadCount(),
    store.unreadCountOfKind(STOP_BREACHED_KIND),
  ])
  const approvals = ctx.live.snapshot().pending.filter((entry) => entry.kind === 'approval')

  return json({
    items: rows.flatMap((row) => toNoticeWire(row) ?? []),
    unread,
    needsYou: approvals.length + stops,
  } satisfies NoticesResponse)
}

/** No body, or no `ids`, reads everything. */
async function handleNoticesRead(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body = await readJsonBody(req)
  const parsed = READ_BODY.safeParse(body === undefined ? {} : body)

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  const store = ctx.app.resolve('noticeStore')

  await store.markRead(parsed.data.ids, Date.now())

  const unread = await store.unreadCount()

  ctx.app.resolve('bus').emit('notices_changed', { unread })

  return json({ unread } satisfies NoticesReadResponse)
}

function handleBoard(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return Promise.resolve(json({ entries: ctx.live.board() } satisfies BoardResponse))
}

export const NOTICE_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/notices', auth: true, handler: handleNotices },
  { method: 'POST', path: '/v1/notices/read', auth: true, handler: handleNoticesRead },
  { method: 'GET', path: '/v1/board', auth: true, handler: handleBoard },
]

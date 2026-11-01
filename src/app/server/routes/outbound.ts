import type { OutboundResponse } from '@/app/server/wire/outbound'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { buildOutboundHosts } from '@/app/outbound-hosts'
import { json } from '@/app/server/http/dispatch'

async function handleOutbound(req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json({ hosts: await buildOutboundHosts(ctx.app, req.signal) } satisfies OutboundResponse)
}

export const OUTBOUND_ROUTES = [
  { method: 'GET', path: '/v1/outbound', auth: true, handler: handleOutbound },
] as const satisfies readonly ApiRouteSpec[]

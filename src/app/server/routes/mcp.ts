import { z } from 'zod'

import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { readJsonBody } from '@/app/server/routes/params'
import { BRAND } from '@/core/brand'
import { sessionId } from '@/core/ids'
import { formatErrForLog } from '@/core/security/credentials'
import { toAdvertisedTools } from '@/engine/api'

// A JSON-RPC transport over the same McpSurface the `mcp serve` command exposes on stdio: one surface,
// two transports. HTTP cannot elicit an approval from the operator, so no `approval` is passed —
// dangerous tools fail closed here, which is the intended answer for an unattended caller.

const PROTOCOL_VERSION = '2025-06-18'
const PARSE_ERROR = -32_700
const INVALID_REQUEST = -32_600
const METHOD_NOT_FOUND = -32_601
const INVALID_PARAMS = -32_602
const INTERNAL_ERROR = -32_603
const INTERNAL_ERROR_MESSAGE = 'internal error'
const NOTIFICATION_ACCEPTED = 202
// Each HTTP call runs on its own session, like the jobs the stdio server starts.
const CALL_SESSION_PREFIX = 'mcp_http_'

const RPC_REQUEST = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string(),
  params: z.object({ name: z.string().optional(), arguments: z.unknown().optional() }).optional(),
})

type RpcRequest = z.infer<typeof RPC_REQUEST>
type RpcId = RpcRequest['id']

async function handleMcp(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body: unknown = await readJsonBody(req)

  if (body === null) {
    return rpcError(null, PARSE_ERROR, 'parse error')
  }

  const parsed = RPC_REQUEST.safeParse(body)

  if (!parsed.success) {
    return rpcError(null, INVALID_REQUEST, 'invalid request')
  }

  try {
    return await dispatch(parsed.data, req, ctx)
  } catch (err: unknown) {
    ctx.app.resolve('logger').error('api.mcp_failed', { err: formatErrForLog(err) })

    return rpcError(parsed.data.id, INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE)
  }
}

async function dispatch(msg: RpcRequest, req: Request, ctx: ApiRouteContext): Promise<Response> {
  const surface = ctx.app.resolve('mcpSurface')

  if (msg.method === 'initialize') {
    return reply(msg.id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: BRAND.name, version: BRAND.version },
      instructions: await surface.instructions(),
    })
  }

  if (msg.method === 'notifications/initialized') {
    return new Response(null, { status: NOTIFICATION_ACCEPTED })
  }

  if (msg.method === 'ping') {
    return reply(msg.id, {})
  }

  if (msg.method === 'tools/list') {
    return reply(msg.id, { tools: toAdvertisedTools(surface.tools()) })
  }

  if (msg.method === 'tools/call') {
    return callTool(msg, req, ctx)
  }

  return rpcError(msg.id, METHOD_NOT_FOUND, `method not found: ${msg.method}`)
}

async function callTool(msg: RpcRequest, req: Request, ctx: ApiRouteContext): Promise<Response> {
  const name = msg.params?.name

  if (name === undefined) {
    return rpcError(msg.id, INVALID_PARAMS, 'tools/call requires params.name')
  }

  const result = await ctx.app.resolve('mcpSurface').invoke({
    name,
    input: msg.params?.arguments,
    sessionId: sessionId(`${CALL_SESSION_PREFIX}${crypto.randomUUID()}`),
    // The client hanging up, or the daemon shutting down, both cancel the tool.
    signal: AbortSignal.any([req.signal, ctx.app.signal]),
  })

  return reply(msg.id, {
    content: [{ type: 'text', text: result.content }],
    isError: result.isError,
  })
}

function reply(id: RpcId, result: unknown): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, result })
}

function rpcError(id: RpcId, code: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

export const MCP_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'POST', path: '/v1/mcp', auth: true, handler: handleMcp },
]

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import type { HaltBody, SetExitBody, TradeActionResponse } from '@/app/server/wire/orders'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  toConfirmOrderWire,
  toExitWire,
  toReconcileOrdersWire,
  toTradeStatusWire,
} from '@/app/server/mappers/orders'
import {
  hostOf,
  localeOf,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  parsePathId,
  readJsonBody,
} from '@/app/server/routes/params'
import { ticker, venueRef } from '@/trading/api'

/** A confirmation token is a UUID; anything far longer is a client bug, not a token. */
const MAX_TOKEN_LENGTH = 100

const EXIT_BODY: z.ZodType<SetExitBody> = z
  .object({
    ticker: z.string().min(1),
    venue: z.string().min(1).exactOptional(),
    takeProfit: z.number().positive().exactOptional(),
    stopLoss: z.number().positive().exactOptional(),
    quantity: z.number().positive().exactOptional(),
  })
  .refine((body) => body.takeProfit !== undefined || body.stopLoss !== undefined)

const HALT_BODY: z.ZodType<HaltBody> = z.object({ halted: z.boolean() })

function orderToken(raw: string): string {
  if (raw === '' || raw.length > MAX_TOKEN_LENGTH) {
    throw new RangeError('invalid order token')
  }

  return raw
}

/** `ticker` and an optional `venue`, branded; `null` when either is malformed (400). */
function parseExitTarget(raw: { readonly ticker: string; readonly venue?: string | undefined }): {
  readonly ticker: ReturnType<typeof ticker>
  readonly venue?: ReturnType<typeof venueRef>
} | null {
  try {
    return {
      ticker: ticker(raw.ticker),
      ...(raw.venue === undefined ? {} : { venue: venueRef(raw.venue) }),
    }
  } catch {
    return null
  }
}

/** The `Idempotency-Key` a client retries with seeds the exit's exchange client id, so a retry
 *  after a lost response finds the exit the first call placed. A call that sends none is its own
 *  request: it gets a fresh id and no cross-retry protection. `null` when the header is unusable. */
function exitRequestId(req: Request): string | null {
  const header = req.headers.get('idempotency-key')?.trim()

  if (header === undefined) {
    return randomUUID()
  }

  return header === '' || header.length > MAX_IDEMPOTENCY_KEY_LENGTH ? null : header
}

async function handleTradeStatus(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const status = await hostOf(ctx).getTradeStatus({ signal: req.signal })

  return json(toTradeStatusWire(status))
}

/** The token is the idempotency key: a retried confirm finds it spent and places nothing. */
async function handleConfirm(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const token = parsePathId(req, orderToken, 1)

  if (token === null) {
    return apiError('invalid_body')
  }

  const outcome = await hostOf(ctx).confirmOrder({ token, signal: req.signal })

  return json(toConfirmOrderWire(outcome, localeOf(ctx)))
}

async function handleDiscard(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const token = parsePathId(req, orderToken)

  if (token === null) {
    return apiError('invalid_body')
  }

  const ok = await hostOf(ctx).discardOrder({ token, signal: req.signal })

  return json({ ok } satisfies TradeActionResponse)
}

async function handleSetExit(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = EXIT_BODY.safeParse(await readJsonBody(req))
  const target = parsed.success ? parseExitTarget(parsed.data) : null
  const requestId = exitRequestId(req)

  if (!parsed.success || target === null || requestId === null) {
    return apiError('invalid_body')
  }

  const { takeProfit, stopLoss, quantity } = parsed.data
  const outcome = await hostOf(ctx).setExit({
    ...target,
    exit: {
      ...(takeProfit === undefined ? {} : { takeProfit }),
      ...(stopLoss === undefined ? {} : { stopLoss }),
    },
    ...(quantity === undefined ? {} : { quantity }),
    requestId,
  })

  return json(toExitWire(outcome))
}

async function handleCancelExit(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const rawTicker = query.get('ticker')
  const rawVenue = query.get('venue')
  const target =
    rawTicker === null
      ? null
      : parseExitTarget({ ticker: rawTicker, ...(rawVenue === null ? {} : { venue: rawVenue }) })

  if (target === null) {
    return apiError('invalid_body')
  }

  const ok = await hostOf(ctx).cancelExit(target)

  return json({ ok } satisfies TradeActionResponse)
}

async function handleHalt(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = HALT_BODY.safeParse(await readJsonBody(req))

  if (!parsed.success) {
    return apiError('invalid_body')
  }

  await hostOf(ctx).setBuyingHalted({ halted: parsed.data.halted, signal: req.signal })

  return json({ ok: true } satisfies TradeActionResponse)
}

async function handleReconcile(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const review = await hostOf(ctx).reconcileOrders({ signal: req.signal })

  return json(toReconcileOrdersWire(review))
}

/** The operator says they booked this fill themselves. */
async function handleClearUnmirrored(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const token = parsePathId(req, orderToken)

  if (token === null) {
    return apiError('invalid_body')
  }

  const ok = await hostOf(ctx).clearUnmirrored({ token, signal: req.signal })

  return json({ ok } satisfies TradeActionResponse)
}

/** Every route needs a venue that places orders, so all of them sit behind `orders`. */
export const ORDER_ROUTES = [
  {
    method: 'GET',
    path: '/v1/trade',
    auth: true,
    capability: 'orders',
    handler: handleTradeStatus,
  },
  {
    method: 'POST',
    path: '/v1/trade/staged/:token/confirm',
    auth: true,
    capability: 'orders',
    handler: handleConfirm,
  },
  {
    method: 'DELETE',
    path: '/v1/trade/staged/:token',
    auth: true,
    capability: 'orders',
    handler: handleDiscard,
  },
  {
    method: 'POST',
    path: '/v1/trade/exits',
    auth: true,
    capability: 'orders',
    handler: handleSetExit,
  },
  {
    method: 'DELETE',
    path: '/v1/trade/exits',
    auth: true,
    capability: 'orders',
    handler: handleCancelExit,
  },
  { method: 'POST', path: '/v1/trade/halt', auth: true, capability: 'orders', handler: handleHalt },
  {
    method: 'POST',
    path: '/v1/trade/reconcile',
    auth: true,
    capability: 'orders',
    handler: handleReconcile,
  },
  {
    method: 'DELETE',
    path: '/v1/trade/unmirrored/:token',
    auth: true,
    capability: 'orders',
    handler: handleClearUnmirrored,
  },
] as const satisfies readonly ApiRouteSpec[]

import { z } from 'zod'

import type { LedgerPageResponse, LedgerPreviewResponse } from '@/app/server/wire/money'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { TypedPrice } from '@/trading/api'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  toLedgerEntryWire,
  toLedgerWriteWire,
  toRebalanceWire,
  toReconcileWire,
  toStopsWire,
  toVenuesWire,
} from '@/app/server/mappers/money'
import {
  hostOf,
  localeOf,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  parseLimit,
  parseOptionalBranded,
  parseOptionalInstrument,
  parsePathId,
  readJsonBody,
} from '@/app/server/routes/params'
import { ledgerEntryId, SURFACE_LIMITS, TYPED_PRICES, tradingDay } from '@/trading/api'

const LEDGER_BODY = z.object({
  draft: z.unknown(),
  typedPrice: z.enum(TYPED_PRICES).exactOptional(),
})
// An edit previews against the book without the row it replaces.
const PREVIEW_BODY = z.object({ draft: z.unknown(), replacing: z.string().exactOptional() })

async function handleLedgerList(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const limit = parseLimit(query.get('limit'), SURFACE_LIMITS.maximumHistoryItems)
  const cursor = parseOptionalBranded(query.get('cursor'), ledgerEntryId)
  const fromDay = parseOptionalBranded(query.get('fromDay'), tradingDay)
  const toDay = parseOptionalBranded(query.get('toDay'), tradingDay)
  const instrument = parseOptionalInstrument(query)

  if (
    limit === null ||
    cursor === null ||
    fromDay === null ||
    toDay === null ||
    instrument === null
  ) {
    return apiError('invalid_body')
  }

  const page = await hostOf(ctx).listLedger({
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(instrument === undefined ? {} : { instrument }),
    range: {
      ...(fromDay === undefined ? {} : { fromDay }),
      ...(toDay === undefined ? {} : { toDay }),
    },
    signal: req.signal,
  })

  return json({
    entries: page.items.map(toLedgerEntryWire),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  } satisfies LedgerPageResponse)
}

/** The row as it would be written, stored nowhere: the day's market rate where a rate applies. */
async function handleLedgerPreview(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = PREVIEW_BODY.safeParse(await readJsonBody(req))
  const replacing = parseOptionalBranded(parsed.data?.replacing ?? null, ledgerEntryId)

  if (!parsed.success || parsed.data.draft === undefined || replacing === null) {
    return apiError('invalid_body')
  }

  const preview = await hostOf(ctx).previewLedger({
    draft: parsed.data.draft,
    ...(replacing === undefined ? {} : { entryId: replacing }),
    signal: req.signal,
  })
  const { transaction } = preview
  const asks = preview.fxRateApplies && 'conversion' in transaction && 'currency' in transaction

  return json(
    (asks
      ? {
          fxRate: {
            currency: transaction.currency,
            rate: transaction.conversion.rate,
            day: transaction.at,
          },
        }
      : {}) satisfies LedgerPreviewResponse
  )
}

/** The key is the client's, one per user action: a retried POST with the same key records nothing
 *  new, and the same key with a different draft is a 409. */
async function handleLedgerRecord(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const idempotencyKey = req.headers.get('idempotency-key')?.trim() ?? ''

  if (idempotencyKey === '' || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    return apiError('invalid_body')
  }

  const body = await readLedgerBody(req)

  if (body === undefined) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).recordLedger({ ...body, idempotencyKey, signal: req.signal })

  return json(toLedgerWriteWire(result, localeOf(ctx)))
}

/** A full entry id only: the short handle chat prints can match more than one row. */
async function handleLedgerUpdate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const entryId = parsePathId(req, ledgerEntryId)
  const body = await readLedgerBody(req)

  if (entryId === null) {
    return apiError('invalid_body')
  }

  if (body === undefined) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).updateLedgerEntry({ ...body, entryId, signal: req.signal })

  return json(toLedgerWriteWire(result, localeOf(ctx)))
}

async function handleLedgerDelete(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const entryId = parsePathId(req, ledgerEntryId)

  if (entryId === null) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).deleteLedgerEntry({ entryId, signal: req.signal })

  return json(toLedgerWriteWire(result, localeOf(ctx)))
}

async function handleStops(req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(toStopsWire(await hostOf(ctx).getStopDistances({ signal: req.signal })))
}

async function handleRebalance(req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(
    toRebalanceWire(await hostOf(ctx).getRebalance({ signal: req.signal }), localeOf(ctx))
  )
}

async function handleReconcile(req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(toReconcileWire(await hostOf(ctx).getReconcile({ signal: req.signal })))
}

async function handleVenues(req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(toVenuesWire(await hostOf(ctx).listVenues({ signal: req.signal })))
}

/** `{ draft, typedPrice? }`. The draft itself is validated by the host, which owns the one schema
 *  that knows the registered markets and venues. `undefined` means the body was not a JSON object. */
async function readLedgerBody(
  req: Request
): Promise<{ readonly draft: unknown; readonly typedPrice?: TypedPrice } | undefined> {
  const parsed = LEDGER_BODY.safeParse(await readJsonBody(req))

  // JSON has no `undefined`: a draft that reads as one was never sent.
  if (!parsed.success || parsed.data.draft === undefined) {
    return undefined
  }

  const { draft, typedPrice } = parsed.data

  return typedPrice === undefined ? { draft } : { draft, typedPrice }
}

/** The operator's own money, so every route here reads the portfolio capability. */
export const MONEY_ROUTES = [
  {
    method: 'GET',
    path: '/v1/ledger',
    auth: true,
    capability: 'portfolio',
    handler: handleLedgerList,
  },
  {
    method: 'POST',
    path: '/v1/ledger',
    auth: true,
    capability: 'portfolio',
    handler: handleLedgerRecord,
  },
  {
    method: 'POST',
    path: '/v1/ledger/preview',
    auth: true,
    capability: 'portfolio',
    handler: handleLedgerPreview,
  },
  {
    method: 'PATCH',
    path: '/v1/ledger/:id',
    auth: true,
    capability: 'portfolio',
    handler: handleLedgerUpdate,
  },
  {
    method: 'DELETE',
    path: '/v1/ledger/:id',
    auth: true,
    capability: 'portfolio',
    handler: handleLedgerDelete,
  },
  { method: 'GET', path: '/v1/stops', auth: true, capability: 'portfolio', handler: handleStops },
  {
    method: 'GET',
    path: '/v1/venues',
    auth: true,
    capability: 'portfolio',
    handler: handleVenues,
  },
  {
    method: 'GET',
    path: '/v1/rebalance',
    auth: true,
    capability: 'portfolio',
    handler: handleRebalance,
  },
  {
    method: 'GET',
    path: '/v1/reconcile',
    auth: true,
    capability: 'portfolio',
    handler: handleReconcile,
  },
] as const satisfies readonly ApiRouteSpec[]

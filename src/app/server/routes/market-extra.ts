import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toSectorsWire, toSourcesWire } from '@/app/server/mappers/market'
import { hostOf, localeOf, parseOptionalBranded } from '@/app/server/routes/params'
import { marketRef } from '@/trading/api'

/** `market` is required, as on `/v1/screen`: the default market is the one that owns the operator's
 *  region, and a sector table is one market's. */
async function handleSectors(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const market = parseOptionalBranded(new URL(req.url).searchParams.get('market'), marketRef)

  if (market === undefined || market === null) {
    return apiError('invalid_body')
  }

  const view = await hostOf(ctx).getSectors({ market, signal: req.signal })

  return json(toSectorsWire(market, view, localeOf(ctx)))
}

async function handleSources(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(toSourcesWire(hostOf(ctx).listSources()))
}

export const MARKET_EXTRA_ROUTES = [
  { method: 'GET', path: '/v1/sectors', auth: true, handler: handleSectors },
  { method: 'GET', path: '/v1/sources', auth: true, handler: handleSources },
] as const satisfies readonly ApiRouteSpec[]

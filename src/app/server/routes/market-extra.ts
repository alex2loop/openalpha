import type { MarketSessionResponse } from '@/app/server/wire/market'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toSectorsWire, toSourcesWire } from '@/app/server/mappers/market'
import { hostOf, localeOf, parseOptionalBranded } from '@/app/server/routes/params'
import { marketRef, region } from '@/trading/api'

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

/** `/market` for a region, the home region when absent; a region no market owns is `invalid_body`. */
async function handleMarketSession(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const scope = parseOptionalBranded(new URL(req.url).searchParams.get('region'), region)

  if (scope === null) {
    return apiError('invalid_body')
  }

  const session = await hostOf(ctx).readMarketSession({
    ...(scope === undefined ? {} : { region: scope }),
    locale: localeOf(ctx),
    signal: req.signal,
  })

  return json(session satisfies MarketSessionResponse)
}

async function handleSources(_req: Request, ctx: ApiRouteContext): Promise<Response> {
  return json(toSourcesWire(hostOf(ctx).listSources()))
}

export const MARKET_EXTRA_ROUTES = [
  { method: 'GET', path: '/v1/sectors', auth: true, handler: handleSectors },
  { method: 'GET', path: '/v1/sources', auth: true, handler: handleSources },
  { method: 'GET', path: '/v1/market', auth: true, handler: handleMarketSession },
] as const satisfies readonly ApiRouteSpec[]

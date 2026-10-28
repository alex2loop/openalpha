import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { IndexCode, MarketRef } from '@/trading/api'
import { apiError, json } from '@/app/server/http/dispatch'
import { toIndexContributorsWire, toIndexValuationWire } from '@/app/server/mappers/index-reading'
import { hostOf, localeOf, parseOptionalBranded } from '@/app/server/routes/params'
import { isIndexCode, marketRef } from '@/trading/api'

interface IndexScope {
  readonly market: MarketRef
  readonly index: IndexCode
}

/** Both names are required: an index belongs to one market, and the market that carries it is not
 *  the default one. An unknown index, or a market that carries none, is `invalid_body`. */
function scopeOf(req: Request): IndexScope | null {
  const params = new URL(req.url).searchParams
  const market = parseOptionalBranded(params.get('market'), marketRef)
  const index = params.get('index')

  return market === undefined || market === null || index === null || !isIndexCode(index)
    ? null
    : { market, index }
}

async function handleIndexContributors(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const scope = scopeOf(req)

  if (scope === null) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).getIndexContributors({ ...scope, signal: req.signal })

  return json(toIndexContributorsWire(scope, result, localeOf(ctx)))
}

async function handleIndexValuation(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const scope = scopeOf(req)

  if (scope === null) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).getIndexValuation({ ...scope, signal: req.signal })

  return json(toIndexValuationWire(scope, result, localeOf(ctx)))
}

export const INDEX_ROUTES = [
  { method: 'GET', path: '/v1/index-contributors', auth: true, handler: handleIndexContributors },
  { method: 'GET', path: '/v1/index-valuation', auth: true, handler: handleIndexValuation },
] as const satisfies readonly ApiRouteSpec[]

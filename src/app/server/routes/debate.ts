import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import { apiError, json } from '@/app/server/http/dispatch'
import { toDebateWire } from '@/app/server/mappers/debate'
import { hostOf, localeOf, parsePathId } from '@/app/server/routes/params'
import { suggestionId, toDebateView } from '@/trading/api'

/** An unknown id, and a call with no readable debate block (a plan the exit tick recorded), are
 *  both `not_found`: neither has a debate to show. */
async function handleDebate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, suggestionId, 1)

  if (id === null) {
    return apiError('invalid_body')
  }

  const stored = await hostOf(ctx).getSuggestion({ suggestionId: id, signal: req.signal })
  const view = stored === null ? undefined : toDebateView(localeOf(ctx), stored)

  return view === undefined ? apiError('not_found') : json(toDebateWire(view))
}

export const DEBATE_ROUTES: readonly ApiRouteSpec[] = [
  {
    method: 'GET',
    path: '/v1/suggestions/:id/debate',
    auth: true,
    capability: 'suggestions',
    handler: handleDebate,
  },
]

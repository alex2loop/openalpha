import type { ActivityResponse, ResearchResponse } from '@/app/server/wire/activity'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { RunId } from '@/core/ids'
import { apiError, json } from '@/app/server/http/dispatch'
import { toActivityRowWire, toResearchReportWire } from '@/app/server/mappers/activity'
import { parseDayQuery, parsePageQuery } from '@/app/server/routes/params'
import { DEEP_RESEARCHER_ID } from '@/engine/api'

const ACTIVITY_PAGE_LIMIT = 200
const ACTIVITY_CHILDREN_LIMIT = 20

/** The operator's day, in `[locale] timezone`, as the cost caps and `/v1/cost` count it. */
async function handleActivity(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const requested = parseDayQuery(new URL(req.url).searchParams, ctx.app.config.locale.timezone)

  if (requested === null) {
    return apiError('invalid_body')
  }

  const { day, range: bounds } = requested
  const store = ctx.app.resolve('runLogStore')
  const tops = await store.listTopLevel(bounds.fromMs, bounds.toMs, ACTIVITY_PAGE_LIMIT)
  const children = await store.childrenOf(
    tops.map((row) => row.runId),
    ACTIVITY_CHILDREN_LIMIT
  )
  const shown: RunId[] = [...children.values()].flat().map((row) => row.runId)
  const costs = await store.costOf([...tops.map((row) => row.runId), ...shown])

  return json({
    day,
    rows: tops.map((row) => toActivityRowWire(row, { costs, children })),
  } satisfies ActivityResponse)
}

/** `before` is epoch ms, the `endedAt` of the last report a page showed. */
async function handleResearch(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const page = parsePageQuery(new URL(req.url).searchParams, {
    defaultLimit: ACTIVITY_PAGE_LIMIT,
    maximumLimit: ACTIVITY_PAGE_LIMIT,
    keyset: false,
  })

  if (page === null) {
    return apiError('invalid_body')
  }

  const rows = await ctx.app
    .resolve('runLogStore')
    .listResearch(DEEP_RESEARCHER_ID, page.before ?? Number.MAX_SAFE_INTEGER, page.limit)

  return json({
    reports: rows.flatMap((row) => toResearchReportWire(row) ?? []),
  } satisfies ResearchResponse)
}

export const ACTIVITY_ROUTES: readonly ApiRouteSpec[] = [
  { method: 'GET', path: '/v1/activity', auth: true, handler: handleActivity },
  { method: 'GET', path: '/v1/research', auth: true, handler: handleResearch },
]

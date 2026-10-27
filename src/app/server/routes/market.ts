import { z } from 'zod'

import type {
  AlertCreateBody,
  AlertDisableResponse,
  AlertsResponse,
  MarketsResponse,
  ScreenResponse,
} from '@/app/server/wire/market'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { InstrumentKind } from '@/trading/api'
import { API_CHANNEL, APP_CHAT_ID } from '@/app/server/channel'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  toAlertWire,
  toMacroWire,
  toMarketsWire,
  toOverviewWire,
  toScreenWire,
  toSearchWire,
} from '@/app/server/mappers/market'
import {
  hostOf,
  localeOf,
  parseLimit,
  parseOptionalBranded,
  parsePathId,
  parseTickerRequest,
  readJsonBody,
} from '@/app/server/routes/params'
import { cachedScreen } from '@/app/server/routes/screen-cache'
import {
  alertId,
  disabledSegments,
  marketRef,
  region,
  SURFACE_LIMITS,
  TYPED_PRICES,
} from '@/trading/api'

/** The kinds a screen can be narrowed to; the host refuses a market that holds no such kind. */
const SCREEN_KINDS: ReadonlySet<string> = new Set<InstrumentKind>(['equity', 'etf', 'crypto'])
const MAX_QUERY_LENGTH = 40
const ALERT_BODY: z.ZodType<AlertCreateBody> = z.object({
  instrument: z.object({ ticker: z.string().min(1), market: z.string().min(1).exactOptional() }),
  condition: z.enum(['above', 'below']),
  threshold: z.number().positive(),
  typedPrice: z.enum(TYPED_PRICES).exactOptional(),
})

/** `market` is required: the default market is the one that owns the operator's region, and only
 *  the registry knows which that is. */
async function handleScreen(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const market = parseOptionalBranded(query.get('market'), marketRef)
  // No limit is the board `/screen` prints; the app asks for more only to search its watchlist.
  const limit =
    query.get('limit') === null
      ? SURFACE_LIMITS.defaultScreenCandidates
      : parseLimit(query.get('limit'), SURFACE_LIMITS.maximumScreenCandidates)
  const kind = query.get('kind')

  if (market === undefined || market === null || limit === null) {
    return apiError('invalid_body')
  }

  if (kind !== null && !SCREEN_KINDS.has(kind)) {
    return apiError('invalid_body')
  }

  const read = async (): Promise<ScreenResponse> => {
    const answer = await hostOf(ctx).screen({
      market,
      limit,
      // why-safe: checked against SCREEN_KINDS above, which holds InstrumentKind members only.
      ...(kind === null ? {} : { instrumentKind: kind as InstrumentKind }),
      // A shared board read outlives any one caller: it ends on the host's own ceiling or shutdown,
      // never on the hang-up of whichever request started it.
      signal: ctx.app.signal,
    })

    return toScreenWire(market, answer)
  }

  return json(await cachedScreen(`${market}|${kind ?? ''}|${limit ?? ''}`, read))
}

async function handleInstrumentSearch(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const text = query.get('q')?.trim() ?? ''
  const limit = parseLimit(query.get('limit'), SURFACE_LIMITS.maximumSearchItems)

  if (text === '' || text.length > MAX_QUERY_LENGTH || limit === null) {
    return apiError('invalid_body')
  }

  const matches = await hostOf(ctx).searchInstruments({ query: text, limit, signal: req.signal })

  return json(toSearchWire(matches))
}

async function handleMarkets(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const host = hostOf(ctx)
  const profile = await host.getProfile(req.signal)
  const view = host.describeMarkets(Date.now())

  return json(toMarketsWire(view, disabledSegments(profile.caps)) satisfies MarketsResponse)
}

/** The home region's markets lead; the rest keep the daemon's order. */
async function handleOverview(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const host = hostOf(ctx)
  const blocks = await host.getOverview(req.signal)
  const { homeRegion, markets } = host.describeMarkets(Date.now())
  const home = new Set(markets.filter((m) => m.region === homeRegion).map((m) => m.market))
  const ordered = [
    ...blocks.filter((block) => home.has(block.market)),
    ...blocks.filter((block) => !home.has(block.market)),
  ]

  return json(toOverviewWire(ordered, localeOf(ctx)))
}

async function handleMacro(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const scope = parseOptionalBranded(new URL(req.url).searchParams.get('region'), region)

  if (scope === null) {
    return apiError('invalid_body')
  }

  const view = await hostOf(ctx).getMacroRisk({
    ...(scope === undefined ? {} : { region: scope }),
    signal: req.signal,
  })

  return json(toMacroWire(view, localeOf(ctx)))
}

async function handleAlertsList(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const limit = parseLimit(query.get('limit'), SURFACE_LIMITS.maximumAlertItems)
  const cursor = parseOptionalBranded(query.get('cursor'), alertId)

  if (limit === null || cursor === null) {
    return apiError('invalid_body')
  }

  const page = await hostOf(ctx).listAlerts({
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    signal: req.signal,
  })

  return json({
    alerts: page.items.map(toAlertWire),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    activeCount: page.activeCount,
  } satisfies AlertsResponse)
}

/** The alert fires to this app: the api surface shows whatever chat id a notice names. */
async function handleAlertCreate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const parsed = ALERT_BODY.safeParse(await readJsonBody(req))
  const instrument = parsed.success ? parseTickerRequest(parsed.data.instrument) : null

  if (!parsed.success || instrument === null) {
    return apiError('invalid_body')
  }

  const alert = await hostOf(ctx).createAlert({
    instrument,
    condition: parsed.data.condition,
    threshold: parsed.data.threshold,
    delivery: { channel: API_CHANNEL, chatId: APP_CHAT_ID },
    ...(parsed.data.typedPrice === undefined ? {} : { typedPrice: parsed.data.typedPrice }),
    signal: req.signal,
  })

  return json(toAlertWire(alert))
}

async function handleAlertDisable(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, alertId)

  if (id === null) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).disableAlert({ alertId: id, signal: req.signal })

  return json({ result } satisfies AlertDisableResponse)
}

export const MARKET_ROUTES = [
  { method: 'GET', path: '/v1/screen', auth: true, handler: handleScreen },
  { method: 'GET', path: '/v1/instruments', auth: true, handler: handleInstrumentSearch },
  { method: 'GET', path: '/v1/markets', auth: true, handler: handleMarkets },
  { method: 'GET', path: '/v1/overview', auth: true, handler: handleOverview },
  { method: 'GET', path: '/v1/macro', auth: true, handler: handleMacro },
  { method: 'GET', path: '/v1/alerts', auth: true, handler: handleAlertsList },
  { method: 'POST', path: '/v1/alerts', auth: true, handler: handleAlertCreate },
  { method: 'DELETE', path: '/v1/alerts/:id', auth: true, handler: handleAlertDisable },
] as const satisfies readonly ApiRouteSpec[]

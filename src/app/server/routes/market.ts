import { z } from 'zod'

import type {
  AlertCreateBody,
  AlertDisableResponse,
  AlertsResponse,
  MarketsResponse,
  ScreenResponse,
} from '@/app/server/wire/market'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { InstrumentKind, MarketRef, Ticker, TradingMarketsView } from '@/trading/api'
import { API_CHANNEL, APP_CHAT_ID } from '@/app/server/channel'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  toAlertWire,
  toMacroWire,
  toMarketsWire,
  toOverviewWire,
  toSearchWire,
} from '@/app/server/mappers/market'
import { toScreenPage, toScreenWire } from '@/app/server/mappers/screen'
import {
  hostOf,
  localeOf,
  parseLimit,
  parseOptionalBranded,
  parsePageOffset,
  parsePathId,
  parseTickerRequest,
  readJsonBody,
} from '@/app/server/routes/params'
import { cachedScreen } from '@/app/server/routes/screen-cache'
import { formatErrForLog } from '@/core/security/credentials'
import {
  alertId,
  disabledSegments,
  marketRef,
  region,
  SURFACE_LIMITS,
  TYPED_PRICES,
  ticker,
} from '@/trading/api'

/** The kinds a screen can be narrowed to; the host refuses a market that holds no such kind. */
const SCREEN_KINDS: ReadonlySet<string> = new Set<InstrumentKind>(['equity', 'etf', 'crypto'])
const MAX_QUERY_LENGTH = 40
// `?fresh=1`: rank the board again rather than serve the one already read.
const FRESH_FLAG = '1'
const ALERT_BODY: z.ZodType<AlertCreateBody> = z.object({
  instrument: z.object({ ticker: z.string().min(1), market: z.string().min(1).exactOptional() }),
  condition: z.enum(['above', 'below']),
  threshold: z.number().positive(),
  typedPrice: z.enum(TYPED_PRICES).exactOptional(),
})

/** `market` is required: the default market is the one that owns the operator's region, and only
 *  the registry knows which that is. `cursor` pages a `list` board (the previous page's `next`); the
 *  board itself is read and cached whole. `ticker` keeps one name's row, as a name's card reads it. */
async function handleScreen(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const asked = parseScreenQuery(query)

  if (asked === null) {
    return apiError('invalid_body')
  }

  const { market, limit, offset, kind, name } = asked
  const read = async (): Promise<ScreenResponse> => {
    const answer = await hostOf(ctx).screen({
      market,
      limit,
      ...(kind === undefined ? {} : { instrumentKind: kind }),
      ...(name === undefined ? {} : { ticker: name }),
      // A shared board read outlives any one caller: it ends on the host's own ceiling or shutdown,
      // never on the hang-up of whichever request started it.
      signal: ctx.app.signal,
    })

    return toScreenWire(market, answer)
  }
  const key = `${market}|${kind ?? ''}|${limit}|${name ?? ''}`
  const board = await cachedScreen(key, read, query.get('fresh') === FRESH_FLAG)

  return json(toScreenPage(board, { offset, limit }))
}

interface ScreenQuery {
  readonly market: MarketRef
  readonly limit: number
  readonly offset: number
  readonly kind?: InstrumentKind
  readonly name?: Ticker
}

/** `null` for a missing market or any malformed field (400). */
function parseScreenQuery(query: URLSearchParams): ScreenQuery | null {
  const market = parseOptionalBranded(query.get('market'), marketRef)
  // No limit is the board `/screen` prints; the app asks for more only to search its watchlist.
  const limit =
    query.get('limit') === null
      ? SURFACE_LIMITS.defaultScreenCandidates
      : parseLimit(query.get('limit'), SURFACE_LIMITS.maximumScreenCandidates)
  const offset = parsePageOffset(query.get('cursor'))
  const kind = query.get('kind')
  const name = parseOptionalBranded(query.get('ticker'), ticker)
  const isMalformed = limit === null || offset === null || name === null

  if (market === undefined || market === null || isMalformed) {
    return null
  }

  if (kind !== null && !SCREEN_KINDS.has(kind)) {
    return null
  }

  return {
    market,
    limit,
    offset,
    // why-safe: checked against SCREEN_KINDS above, which holds InstrumentKind members only.
    ...(kind === null ? {} : { kind: kind as InstrumentKind }),
    ...(name === undefined ? {} : { name }),
  }
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

// The segments the operator switched off. When the profile cannot be read the list still answers,
// with every market on but those no venue can hold: the page then keeps the office open, never
// wrongly shut.
async function switchedOffSegments(
  req: Request,
  ctx: ApiRouteContext,
  view: TradingMarketsView
): Promise<ReadonlySet<string>> {
  try {
    return disabledSegments((await hostOf(ctx).getProfile(req.signal)).caps)
  } catch (err: unknown) {
    if (req.signal.aborted) {
      throw err
    }

    ctx.app.resolve('logger').warn('api.markets_profile_unreadable', { err: formatErrForLog(err) })

    return new Set(
      view.markets.filter((market) => !market.holdable).map((market) => market.segment)
    )
  }
}

async function handleMarkets(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const view = hostOf(ctx).describeMarkets(Date.now())
  const off = await switchedOffSegments(req, ctx, view)

  return json(toMarketsWire(view, off) satisfies MarketsResponse)
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

  return json(toOverviewWire(ordered, localeOf(ctx), ctx.app.config.locale.timezone))
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

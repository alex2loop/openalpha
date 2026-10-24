import { z } from 'zod'

import type { ApiErrorCode } from '@/app/server/wire/errors'
import type { BriefScheduleWire } from '@/app/server/wire/system'
import type {
  SuggestionCardResponse,
  TradingBriefResponse,
  TradingEventsResponse,
  TradingNewsResponse,
  TradingOhlcvResponse,
  TradingSuggestionsResponse,
} from '@/app/server/wire/trading'
import type { ApiRouteContext, ApiRouteSpec } from '@/app/types'
import type { SourceResult } from '@/trading/api'
import { apiError, json } from '@/app/server/http/dispatch'
import {
  toBriefScheduleWire,
  toBriefSnapshotWire,
  toBriefTextWire,
} from '@/app/server/mappers/brief'
import {
  toCandleWire,
  toCaveatWires,
  toMarketEventWire,
  toNavWire,
  toNewsItemWire,
  toPortfolioWire,
  toProfileWire,
  toProvenanceWires,
  toQuotesResponse,
  toSuggestionCardWire,
  toSuggestionWire,
  toTrackRecordWire,
} from '@/app/server/mappers/trading'
import {
  hostOf,
  localeOf,
  parseInstrument,
  parseLimit,
  parseOneOf,
  parseOptionalBranded,
  parseOptionalInstrument,
  parsePathId,
  readJsonBody,
} from '@/app/server/routes/params'
import { bindLocale } from '@/i18n'
import {
  DEFAULT_NAV_WINDOW,
  NAV_WINDOWS,
  region,
  SUGGESTION_LIST_STATUSES,
  SURFACE_LIMITS,
  suggestionId,
  tradingDay,
} from '@/trading/api'

const AMBIGUOUS_SYMBOL = 'source.ambiguous-symbol'

/** Every handler: parse the query, call exactly one host method, project through one mapper. The
 *  host owns the operator identity and the numeric bounds, so a route holds no authorization, no
 *  registry lookup, and no default of its own. Codes and data only — rendering is the client's. */

async function handleTradingQuotes(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const quoteBoard = await hostOf(ctx).getQuotes(req.signal)

  return json(toQuotesResponse(quoteBoard, localeOf(ctx)))
}

async function handleTradingOhlcv(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const instrument = parseInstrument(query)
  const fromDay = parseOptionalBranded(query.get('fromDay'), tradingDay)
  const toDay = parseOptionalBranded(query.get('toDay'), tradingDay)

  if (instrument === null || !fromDay || !toDay) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).getOhlcv({
    instrument,
    fromDay,
    toDay,
    signal: req.signal,
  })

  if (result.kind === 'unavailable') {
    return sourceError(ctx, result, instrument.ticker)
  }

  return json({
    market: instrument.market,
    ticker: instrument.ticker,
    bars: result.value.map(toCandleWire),
    provenance: toProvenanceWires(result.provenance),
    caveats: toCaveatWires(result.caveats, localeOf(ctx)),
  } satisfies TradingOhlcvResponse)
}

async function handleTradingEvents(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const instrument = parseInstrument(query)
  const fromDay = parseOptionalBranded(query.get('fromDay'), tradingDay)
  const toDay = parseOptionalBranded(query.get('toDay'), tradingDay)

  if (instrument === null || !fromDay || !toDay) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).getEvents({ instrument, fromDay, toDay, signal: req.signal })

  // A market no event source covers has no events to show, which is an answer, not a failure.
  if (result.kind === 'unavailable' && result.reason !== 'unsupported') {
    return sourceError(ctx, result, instrument.ticker)
  }

  const found = result.kind === 'available'

  return json({
    market: instrument.market,
    ticker: instrument.ticker,
    events: found ? result.value.map(toMarketEventWire) : [],
    provenance: found ? toProvenanceWires(result.provenance) : [],
    caveats: toCaveatWires(result.caveats, localeOf(ctx)),
  } satisfies TradingEventsResponse)
}

async function handleTradingNews(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const limit = parseLimit(query.get('limit'), SURFACE_LIMITS.maximumNewsItems)
  const scope = parseOptionalBranded(query.get('region'), region)

  if (limit === null || scope === null) {
    return apiError('invalid_body')
  }

  const view = await hostOf(ctx).getNews({
    ...(scope === undefined ? {} : { region: scope }),
    limit,
    signal: req.signal,
  })
  const result = view.result

  if (result.kind === 'unavailable') {
    return sourceError(ctx, result)
  }

  return json({
    region: view.region,
    items: result.value.map(toNewsItemWire),
    provenance: toProvenanceWires(result.provenance),
    caveats: toCaveatWires(result.caveats, localeOf(ctx)),
  } satisfies TradingNewsResponse)
}

type UnavailableResult = Extract<SourceResult<unknown>, { readonly kind: 'unavailable' }>

/** An ambiguous symbol is a 409 that says so: without its sentence the app could only guess. */
function sourceError(ctx: ApiRouteContext, result: UnavailableResult, symbol?: string): Response {
  const ambiguous = result.caveats.find((caveat) => caveat.code === AMBIGUOUS_SYMBOL)

  if (ambiguous === undefined || symbol === undefined) {
    return apiError(sourceErrorCode(result))
  }

  const message = bindLocale(localeOf(ctx)).translate(`trading.caveat.${AMBIGUOUS_SYMBOL}`, {
    ...ambiguous.detail,
    ticker: symbol,
  })

  return apiError('conflict', message)
}

function sourceErrorCode(result: UnavailableResult): ApiErrorCode {
  if (result.caveats.some((caveat) => caveat.code === AMBIGUOUS_SYMBOL)) {
    return 'conflict'
  }

  if (result.reason === 'unsupported') {
    return 'not_found'
  }

  return result.reason === 'failed' ? 'upstream_failed' : 'unavailable'
}

async function handleTradingProfileGet(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const profile = await hostOf(ctx).getProfile(req.signal)

  return json(toProfileWire(profile, localeOf(ctx)))
}

async function handleTradingProfileUpdate(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body: unknown = await readJsonBody(req)
  const request = parseProfileUpdate(body)

  if (request === null) {
    return apiError('invalid_body')
  }

  const profile = await hostOf(ctx).updateProfile({
    ...request,
    signal: req.signal,
  })

  return json(toProfileWire(profile, localeOf(ctx)))
}

async function handleTradingPortfolio(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const book = await hostOf(ctx).getPortfolio({ signal: req.signal })

  return json(toPortfolioWire(book, localeOf(ctx)))
}

async function handleTradingNav(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const raw = new URL(req.url).searchParams.get('window')
  const window = raw === null ? DEFAULT_NAV_WINDOW : parseOneOf(raw, NAV_WINDOWS)

  if (window === null) {
    return apiError('invalid_body')
  }

  return json(toNavWire(await hostOf(ctx).getNavHistory({ window, signal: req.signal })))
}

async function handleTradingSuggestions(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const query = new URL(req.url).searchParams
  const limit = parseLimit(query.get('limit'), SURFACE_LIMITS.maximumTrackRecordItems)
  const cursor = parseOptionalBranded(query.get('cursor'), suggestionId)
  const status = parseOneOf(query.get('status'), SUGGESTION_LIST_STATUSES)
  const instrument = parseOptionalInstrument(query)

  if (limit === null || cursor === null || status === null || instrument === null) {
    return apiError('invalid_body')
  }

  const focus = query.get('focus')
  const page = await hostOf(ctx).listSuggestions({
    status,
    ...(focus === null ? {} : { focusKey: focus }),
    ...(instrument === undefined ? {} : { instrument }),
    ...(cursor === undefined ? {} : { cursor }),
    limit,
    signal: req.signal,
  })

  return json({
    suggestions: page.items.map((suggestion) => toSuggestionWire(suggestion, localeOf(ctx))),
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  } satisfies TradingSuggestionsResponse)
}

async function handleSuggestionCard(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const id = parsePathId(req, suggestionId, 1)

  if (id === null) {
    return apiError('invalid_body')
  }

  const card = await hostOf(ctx).getSuggestionCard({ suggestionId: id, signal: req.signal })

  return json({
    card: card === null ? null : toSuggestionCardWire(card),
  } satisfies SuggestionCardResponse)
}

async function handleTradingTrackRecord(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const limit = parseLimit(
    new URL(req.url).searchParams.get('limit'),
    SURFACE_LIMITS.maximumTrackRecordItems
  )

  if (limit === null) {
    return apiError('invalid_body')
  }

  const view = await hostOf(ctx).getTrackRecord({ limit, signal: req.signal })

  return json(toTrackRecordWire(view, localeOf(ctx)))
}

async function handleTradingBrief(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const scope = parseOptionalBranded(new URL(req.url).searchParams.get('region'), region)

  if (scope === null) {
    return apiError('invalid_body')
  }

  const view = await hostOf(ctx).getBrief({
    ...(scope === undefined ? {} : { region: scope }),
    signal: req.signal,
  })

  return json({
    snapshot:
      view.snapshot === null
        ? null
        : toBriefSnapshotWire({ ...view, snapshot: view.snapshot }, localeOf(ctx)),
    text: view.text === null ? null : toBriefTextWire(view.text),
  } satisfies TradingBriefResponse)
}

const RESCHEDULE_BODY = z.object({ sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })

/** Moves the brief's send time and leaves its delivery address where it is. */
async function handleBriefReschedule(req: Request, ctx: ApiRouteContext): Promise<Response> {
  const body = RESCHEDULE_BODY.safeParse(await readJsonBody(req))

  if (!body.success) {
    return apiError('invalid_body')
  }

  const result = await hostOf(ctx).rescheduleBrief({
    sendTime: body.data.sendTime,
    signal: req.signal,
  })

  if (result.kind === 'rejected') {
    return apiError(
      result.reason === 'not-enabled' || result.reason === 'delivering'
        ? 'conflict'
        : 'invalid_body',
      result.message
    )
  }

  return json(toBriefScheduleWire(result.delivery) satisfies BriefScheduleWire)
}

function parseProfileUpdate(body: unknown): { readonly patch: Record<string, unknown> } | null {
  if (typeof body !== 'object' || body === null || !('patch' in body)) {
    return null
  }

  const { patch } = body

  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    return null
  }

  return { patch: { ...patch } }
}

/** Nine specs as data. `feature.ts` composes and validates the final table once — trading does not
 *  extend `apiRoutes` at runtime, which would leave the route table mutable after boot. The four
 *  `capability` values are the four flags that already existed; news, profile, and brief carry
 *  none because they are not optional surfaces. */
export const TRADING_ROUTES = [
  {
    method: 'GET',
    path: '/v1/quotes',
    auth: true,
    capability: 'quotes',
    handler: handleTradingQuotes,
  },
  {
    method: 'GET',
    path: '/v1/ohlcv',
    auth: true,
    capability: 'ohlcv',
    handler: handleTradingOhlcv,
  },
  {
    method: 'GET',
    path: '/v1/events',
    auth: true,
    capability: 'ohlcv',
    handler: handleTradingEvents,
  },
  { method: 'GET', path: '/v1/news', auth: true, handler: handleTradingNews },
  { method: 'GET', path: '/v1/profile', auth: true, handler: handleTradingProfileGet },
  { method: 'POST', path: '/v1/profile', auth: true, handler: handleTradingProfileUpdate },
  {
    method: 'GET',
    path: '/v1/portfolio',
    auth: true,
    capability: 'portfolio',
    handler: handleTradingPortfolio,
  },
  {
    method: 'GET',
    path: '/v1/portfolio/nav',
    auth: true,
    capability: 'portfolio',
    handler: handleTradingNav,
  },
  {
    method: 'GET',
    path: '/v1/suggestions',
    auth: true,
    capability: 'suggestions',
    handler: handleTradingSuggestions,
  },
  {
    method: 'GET',
    path: '/v1/suggestions/:id/card',
    auth: true,
    capability: 'suggestions',
    handler: handleSuggestionCard,
  },
  {
    method: 'GET',
    path: '/v1/track-record',
    auth: true,
    capability: 'suggestions',
    handler: handleTradingTrackRecord,
  },
  { method: 'GET', path: '/v1/brief', auth: true, handler: handleTradingBrief },
  { method: 'PATCH', path: '/v1/brief', auth: true, handler: handleBriefReschedule },
] as const satisfies readonly ApiRouteSpec[]

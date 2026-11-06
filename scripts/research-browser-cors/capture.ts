import type { RequestShape } from '@/core/http-client'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { RegisteredSource, SourceContext } from '@/trading/kernel/source/source-result'
import type { SourceFacts } from '@/trading/sources/types'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { PAGE_REQUEST_SHAPE } from '@/core/http-client'
import { silentLogger } from '@/core/logging/silent-logger'
import { resolveCredential } from '@/core/security/credentials'
import {
  currencyCode,
  fxPair,
  marketRef,
  region,
  ticker,
  tradingDay,
} from '@/trading/kernel/instrument'
import { ECONOMY_FEED_SCOPE } from '@/trading/kernel/source/source-result'
import { RSS_FEEDS } from '@/trading/sources/adapters/rss'
import { ANY_SCOPE, SOURCE_ROUTES } from '@/trading/sources/routes'
import { createSourceHttp } from '@/trading/sources/transport/http'
import {
  createBuiltInSources,
  SOURCE_BURST_LIMITS,
  SOURCE_CREDENTIAL_ENV,
  SOURCE_ENDPOINTS,
  SOURCE_RATE_LIMITS,
} from '@/trading/wiring/composition/source-facts'

import type { Capture, Captured } from './types'

const PROBE_SETTLE_MS = 100
const FROM_DAY = tradingDay('2026-10-01')
const TO_DAY = tradingDay('2026-11-02')
const PROBE_LIMIT = 30
const NEEDS_KEY = 'needs-key'

interface CellProbe {
  readonly kind: string
  readonly scope: string
  readonly id: SourceId
}

type Recorded = readonly Captured[] | typeof NEEDS_KEY

/** The keys the environment holds, by provider; the report masks them out of every URL it prints. */
export const credentials = resolveCredentials()

const facts: SourceFacts = {
  endpoints: SOURCE_ENDPOINTS,
  rateLimits: SOURCE_RATE_LIMITS,
  burstLimits: SOURCE_BURST_LIMITS,
  feeds: RSS_FEEDS,
  credentials,
  // A page cannot set `user-agent`, so no provider is served the plain agent string.
  plainUserAgentSources: new Set(),
  requestShape: PAGE_REQUEST_SHAPE satisfies RequestShape,
}

/** Runs every route cell's adapter against a recording `fetch`, so each provider's real request
 *  path (host, path, params, headers) is what gets measured. One request per provider path. */
export async function captureRequests(): Promise<Capture> {
  const found = new Map<string, Captured>()
  const unprobed: string[] = []
  const needsKey = new Set<SourceId>()

  for (const probe of listCellProbes()) {
    const recorded = await recordCell(probe)

    if (recorded === NEEDS_KEY) {
      needsKey.add(probe.id)

      continue
    }

    if (recorded.length === 0) {
      unprobed.push(`${probe.kind}/${probe.scope}:${probe.id}`)
    }

    for (const request of recorded) {
      const { origin, pathname } = new URL(request.url)
      const key = `${request.id} ${origin}${pathname}`

      if (!found.has(key)) {
        found.set(key, request)
      }
    }
  }

  const probedIds = new Set([...found.values()].map(({ id }) => id))

  return {
    captured: [...found.values()].sort((left, right) => left.id.localeCompare(right.id)),
    unprobed,
    needsKey: [...needsKey].filter((id) => !probedIds.has(id)),
  }
}

function listCellProbes(): readonly CellProbe[] {
  return Object.entries(SOURCE_ROUTES).flatMap(([kind, scopes]) =>
    Object.entries(scopes).flatMap(([scope, ids]) => ids.map((id) => ({ kind, scope, id })))
  )
}

function resolveCredentials(): Readonly<Partial<Record<SourceId, string>>> {
  const resolved: Partial<Record<SourceId, string>> = {}

  for (const [id, variable] of Object.entries(SOURCE_CREDENTIAL_ENV)) {
    const value = variable === undefined ? undefined : resolveCredential(process.env, variable)

    if (value !== undefined && value.length > 0) {
      // why-safe: the credential table is keyed by SourceId; Object.entries widens the key.
      resolved[id as SourceId] = value
    }
  }

  return resolved
}

async function recordCell(probe: CellProbe): Promise<Recorded> {
  for (const context of contextsFor(probe.scope)) {
    const outcome = await recordFetches(probe, context)

    if (outcome === NEEDS_KEY || outcome.length > 0) {
      return outcome
    }
  }

  return []
}

async function recordFetches(probe: CellProbe, context: SourceContext): Promise<Recorded> {
  const source = findSource(probe)
  const recorded: Captured[] = []
  const controller = new AbortController()
  const realFetch = globalThis.fetch
  let timer: ReturnType<typeof setTimeout> | undefined

  // A transport failure sends the request on to the provider's next host, so every host is seen;
  // the retry backoff that follows is cut by the abort.
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      recorded.push(toCaptured(probe, input instanceof Request ? input.url : String(input), init))
      timer ??= setTimeout(() => controller.abort(), PROBE_SETTLE_MS)

      throw new TypeError('recorded, not sent')
    },
    { preconnect: realFetch.preconnect }
  )

  try {
    await source?.fetch(context, controller.signal)
  } catch (err: unknown) {
    if (err instanceof OperatorConfigError) {
      return NEEDS_KEY
    }
  } finally {
    globalThis.fetch = realFetch
    clearTimeout(timer)
  }

  return recorded
}

function findSource(probe: CellProbe): RegisteredSource | undefined {
  const http = createSourceHttp(facts, Date.now, silentLogger)

  return createBuiltInSources({ http, feeds: facts.feeds }).find(
    (source) => source.kind === probe.kind && source.id === probe.id
  )
}

function toCaptured(probe: CellProbe, url: string, init: RequestInit | undefined): Captured {
  return {
    id: probe.id,
    cell: `${probe.kind}/${probe.scope}`,
    url,
    method: init?.method ?? 'GET',
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  }
}

// A scope's contexts, most ordinary first: a provider serves the request shape it `covers`, so a
// scope is tried with each until one reaches the wire.
function contextsFor(scope: string): readonly SourceContext[] {
  switch (scope) {
    case 'equity-us':
      return [instrumentContext('equity-us', 'AAPL'), marketContext(scope)]
    case 'equity-vn':
      return [
        instrumentContext('equity-vn', 'VNM'),
        indexContext('equity-vn', 'VNINDEX'),
        marketContext(scope),
      ]
    case 'crypto':
      return [
        instrumentContext('crypto', 'BTC', { instrumentKind: 'crypto' }),
        marketContext(scope),
      ]
    case 'gold':
      return [instrumentContext('gold', 'XAU', { instrumentKind: 'gold' }), marketContext(scope)]
    case 'gold-vn':
      return [instrumentContext('gold-vn', 'SJC'), marketContext(scope)]
    case 'us':
    case 'vn':
      return [windowContext({ region: region(scope) })]
    case ANY_SCOPE:
      return anyScopeContexts()
    default:
      return [marketContext(scope)]
  }
}

function anyScopeContexts(): readonly SourceContext[] {
  const eur = currencyCode('EUR')
  const usd = currencyCode('USD')
  const vnd = currencyCode('VND')

  return [
    windowContext({ ticker: fxPair(eur, usd) }),
    windowContext({ ticker: fxPair(usd, vnd) }),
    windowContext({ ticker: ticker('BRENT') }),
    windowContext({ ticker: ticker('COAL') }),
    { feedScope: ECONOMY_FEED_SCOPE },
  ]
}

function windowContext(subject: SourceContext): SourceContext {
  return { ...subject, fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT }
}

function marketContext(market: string): SourceContext {
  return windowContext({ market: marketRef(market) })
}

function indexContext(market: string, symbol: string): SourceContext {
  const kind: InstrumentKind = 'index'

  return instrumentContext(market, symbol, { instrumentKind: kind })
}

function instrumentContext(
  market: string,
  symbol: string,
  extra: SourceContext = {}
): SourceContext {
  const ref = marketRef(market)
  const name = ticker(symbol)

  return windowContext({
    market: ref,
    instrument: { market: ref, ticker: name },
    ticker: name,
    tickers: [name],
    searchSubject: [symbol],
    ...extra,
  })
}

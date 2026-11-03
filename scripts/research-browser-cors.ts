#!/usr/bin/env bun
// Measure which providers a browser page can read, and print what the browser route set serves.
//
// Each adapter is run against a recording `fetch`, so the request measured is the one its real
// request path builds (path, params, headers) under `PAGE_REQUEST_SHAPE`, never a host root: a root
// misreports, cafef's has no CORS header while its `GDTuDoanh.ashx` sends `*`. The recorded request
// is then sent once with an `Origin` header, redirects followed by hand because a browser checks
// each hop, with an OPTIONS preflight first when the request is not simple.
//
// Read-only: GET and OPTIONS against public endpoints, one request per provider origin. A provider
// whose credential is not in the environment is listed as not measured; no key is read from a file.
//
// Usage:
//   bun scripts/research-browser-cors.ts
//
// Stands outside the runtime on purpose: it fires real requests the runtime never sends this way.
import type { RequestShape } from '@/core/http-client'
import type { InstrumentKind } from '@/trading/kernel/instrument'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type {
  RegisteredSource,
  SourceContext,
  SourceKind,
} from '@/trading/kernel/source/source-result'
import type { SourceFacts } from '@/trading/sources/types'
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
import { ANY_SCOPE, SOURCE_ROUTES, toBrowserRoutes } from '@/trading/sources/routes'
import { createSourceHttp } from '@/trading/sources/transport/http'
import {
  BROWSER_REACHABLE_SOURCES,
  createBuiltInSources,
  SOURCE_BURST_LIMITS,
  SOURCE_CREDENTIAL_ENV,
  SOURCE_ENDPOINTS,
  SOURCE_RATE_LIMITS,
} from '@/trading/wiring/composition/source-facts'

const PAGE_ORIGIN = 'https://openalpha.example'
const PROBE_SETTLE_MS = 100
const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const PREVIEW_CHARS = 48
const ID_WIDTH = 20
const HOST_WIDTH = 34
const STATUS_WIDTH = 7
const ALLOW_WIDTH = 28
const PREFLIGHT_WIDTH = 16
const SECRET_MASK = '***'
const FROM_DAY = tradingDay('2026-10-01')
const TO_DAY = tradingDay('2026-11-02')
const PROBE_LIMIT = 30
// Request headers a page may send without a preflight (the CORS-safelisted names the transport can
// produce); `content-type` is judged by its value.
const SIMPLE_HEADERS: ReadonlySet<string> = new Set(['accept', 'accept-language', 'content-language'])
const SIMPLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
])
const SIMPLE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST'])
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const NEWLINES_RE = /\s+/g

interface Captured {
  readonly id: SourceId
  readonly cell: string
  readonly url: string
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
}

interface Measurement {
  readonly captured: Captured
  readonly status: string
  readonly allowOrigin: string
  readonly preflight: string
  readonly cors: boolean
  readonly preview: string
}

const credentials = resolveCredentials()
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

const { captured, unprobed, needsKey } = await captureRequests()
const measured = await measureAll(captured)
const passing = passingIds(measured)

printMeasurements(measured)
printNotMeasured(unprobed, needsKey)
printVerdict(passing, measured)
printRouteTable()

// Parallel across providers, in turn within one: a host's own requests never arrive together.
async function measureAll(requests: readonly Captured[]): Promise<readonly Measurement[]> {
  const byId = Map.groupBy(requests, ({ id }) => id)
  const groups = await Promise.all(
    [...byId.values()].map(async (group) => {
      const rows: Measurement[] = []

      for (const request of group) {
        rows.push(await measure(request))
      }

      return rows
    })
  )

  return groups.flat().sort((left, right) => left.captured.id.localeCompare(right.captured.id))
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

interface Capture {
  readonly captured: readonly Captured[]
  readonly unprobed: readonly string[]
  readonly needsKey: readonly SourceId[]
}

async function captureRequests(): Promise<Capture> {
  const found = new Map<string, Captured>()
  const unprobed: string[] = []
  const needsKey = new Set<SourceId>()

  for (const [kind, scopes] of Object.entries(SOURCE_ROUTES)) {
    for (const [scope, ids] of Object.entries(scopes)) {
      for (const id of ids) {
        const cell = `${kind}/${scope}`
        const recorded = await recordCell({ kind, scope, id })

        if (recorded === 'needs-key') {
          needsKey.add(id)
        } else if (recorded.length === 0) {
          unprobed.push(`${cell}:${id}`)
        }

        for (const request of recorded === 'needs-key' ? [] : recorded) {
          const { origin, pathname } = new URL(request.url)

          if (!found.has(`${id} ${origin}${pathname}`)) {
            found.set(`${id} ${origin}${pathname}`, request)
          }
        }
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

interface CellProbe {
  readonly kind: string
  readonly scope: string
  readonly id: SourceId
}

async function recordCell(probe: CellProbe): Promise<readonly Captured[] | 'needs-key'> {
  for (const context of contextsFor(probe.scope)) {
    const outcome = await recordFetches(probe, context)

    if (outcome === 'needs-key' || outcome.length > 0) {
      return outcome
    }
  }

  return []
}

async function recordFetches(
  probe: CellProbe,
  context: SourceContext
): Promise<readonly Captured[] | 'needs-key'> {
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
    if (err instanceof Error && err.name === 'OperatorConfigError') {
      return 'needs-key'
    }
  } finally {
    globalThis.fetch = realFetch
    clearTimeout(timer)
  }

  return recorded
}

function findSource(probe: CellProbe): RegisteredSource | undefined {
  const http = createSourceHttp(facts, Date.now, silentLogger)

  return createBuiltInSources({ http }).find(
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

function contextFor(market: string, symbol: string, extra: SourceContext = {}): SourceContext {
  const ref = marketRef(market)
  const name = ticker(symbol)

  return {
    market: ref,
    instrument: { market: ref, ticker: name },
    ticker: name,
    tickers: [name],
    fromDay: FROM_DAY,
    toDay: TO_DAY,
    limit: PROBE_LIMIT,
    searchSubject: [symbol],
    ...extra,
  }
}

function marketContext(market: string): SourceContext {
  return { market: marketRef(market), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT }
}

function levelContext(market: string, symbol: string): SourceContext {
  const kind: InstrumentKind = 'index'

  return contextFor(market, symbol, { instrumentKind: kind })
}

// A scope's contexts, most ordinary first: a provider serves the request shape it `covers`, so a
// scope is tried with each until one reaches the wire.
function contextsFor(scope: string): readonly SourceContext[] {
  const eur = currencyCode('EUR')
  const usd = currencyCode('USD')
  const vnd = currencyCode('VND')

  switch (scope) {
    case 'equity-us':
      return [contextFor('equity-us', 'AAPL'), marketContext(scope)]
    case 'equity-vn':
      return [
        contextFor('equity-vn', 'VNM'),
        levelContext('equity-vn', 'VNINDEX'),
        marketContext(scope),
      ]
    case 'crypto':
      return [contextFor('crypto', 'BTC', { instrumentKind: 'crypto' }), marketContext(scope)]
    case 'gold':
      return [contextFor('gold', 'XAU', { instrumentKind: 'gold' }), marketContext(scope)]
    case 'gold-vn':
      return [contextFor('gold-vn', 'SJC'), marketContext(scope)]
    case 'us':
    case 'vn':
      return [{ region: region(scope), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT }]
    case ANY_SCOPE:
      return [
        { ticker: fxPair(eur, usd), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT },
        { ticker: fxPair(usd, vnd), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT },
        { ticker: ticker('BRENT'), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT },
        { ticker: ticker('COAL'), fromDay: FROM_DAY, toDay: TO_DAY, limit: PROBE_LIMIT },
        { feedScope: ECONOMY_FEED_SCOPE },
      ]
    default:
      return [marketContext(scope)]
  }
}

function needsPreflight(request: Captured): boolean {
  const contentType = request.headers['content-type']

  return (
    !SIMPLE_METHODS.has(request.method) ||
    Object.keys(request.headers).some((name) => !SIMPLE_HEADERS.has(name) && name !== 'content-type') ||
    (contentType !== undefined && !SIMPLE_CONTENT_TYPES.has(contentType.split(';')[0] ?? ''))
  )
}

function allowsOrigin(headers: Headers): boolean {
  const allow = headers.get('access-control-allow-origin')

  return allow === '*' || allow === PAGE_ORIGIN
}

async function measure(request: Captured): Promise<Measurement> {
  const preflight = needsPreflight(request) ? await sendPreflight(request) : 'not needed'
  const preflightOk = preflight === 'not needed' || preflight.startsWith('pass')

  if (request.method !== 'GET') {
    return outcomeOf(request, preflight, undefined, preflightOk)
  }

  try {
    const hops = await followRedirects(request)
    const last = hops[hops.length - 1]

    return outcomeOf(request, preflight, last, preflightOk && hops.every(({ cors }) => cors))
  } catch (err: unknown) {
    return {
      captured: request,
      status: 'error',
      allowOrigin: '-',
      preflight,
      cors: false,
      preview: err instanceof Error ? err.message : String(err),
    }
  }
}

function outcomeOf(
  request: Captured,
  preflight: string,
  last: Hop | undefined,
  cors: boolean
): Measurement {
  return {
    captured: request,
    status: last === undefined ? 'not sent' : String(last.status),
    allowOrigin: last?.allowOrigin ?? '-',
    preflight,
    cors,
    preview: last?.preview ?? 'POST not sent',
  }
}

async function sendPreflight(request: Captured): Promise<string> {
  const names = Object.keys(request.headers).filter((name) => !SIMPLE_HEADERS.has(name))

  try {
    const res = await fetch(request.url, {
      method: 'OPTIONS',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        origin: PAGE_ORIGIN,
        'access-control-request-method': request.method,
        'access-control-request-headers': names.sort().join(','),
      },
    })
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase()
    const headersOk = names.every((name) => allowed.includes(name) || allowed.trim() === '*')
    const ok = res.status >= 200 && res.status < 300 && allowsOrigin(res.headers) && headersOk

    return `${ok ? 'pass' : 'FAIL'} ${res.status}`
  } catch (err: unknown) {
    return `FAIL ${err instanceof Error ? err.name : 'error'}`
  }
}

interface Hop {
  readonly status: number
  readonly allowOrigin: string
  readonly cors: boolean
  readonly preview: string
}

async function followRedirects(request: Captured): Promise<readonly Hop[]> {
  const hops: Hop[] = []
  let url = request.url

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...request.headers, origin: PAGE_ORIGIN },
    })
    const location = res.headers.get('location')

    hops.push({
      status: res.status,
      allowOrigin: res.headers.get('access-control-allow-origin') ?? '-',
      cors: allowsOrigin(res.headers),
      preview: await firstBytes(res),
    })

    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
      return hops
    }

    url = new URL(location, url).href
  }

  return hops
}

async function firstBytes(res: Response): Promise<string> {
  const reader = res.body?.getReader()

  if (reader === undefined) {
    return ''
  }

  try {
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value).replace(NEWLINES_RE, ' ')

    return text.slice(0, PREVIEW_CHARS)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function passingIds(rows: readonly Measurement[]): ReadonlyMap<SourceId, boolean> {
  const verdicts = new Map<SourceId, boolean>()

  for (const { captured: request, cors } of rows) {
    verdicts.set(request.id, (verdicts.get(request.id) ?? true) && cors)
  }

  return verdicts
}

function mask(url: string): string {
  let masked = url

  for (const secret of Object.values(credentials)) {
    masked = secret === undefined ? masked : masked.replaceAll(secret, SECRET_MASK)
  }

  return masked
}

function printMeasurements(rows: readonly Measurement[]): void {
  console.log(`CORS measured with Origin ${PAGE_ORIGIN}, ${new Date().toISOString()}`)
  console.log(
    ['id', 'origin', 'cors', 'status', 'allow-origin', 'preflight', 'first bytes']
      .map((title, index) => title.padEnd([ID_WIDTH, HOST_WIDTH, 5, STATUS_WIDTH, ALLOW_WIDTH, PREFLIGHT_WIDTH, 0][index] ?? 0))
      .join(' ')
  )

  for (const row of rows) {
    const { captured: request } = row

    console.log(
      [
        request.id.padEnd(ID_WIDTH),
        new URL(request.url).origin.replace('https://', '').padEnd(HOST_WIDTH),
        (row.cors ? 'PASS' : 'FAIL').padEnd(5),
        row.status.padEnd(STATUS_WIDTH),
        row.allowOrigin.padEnd(ALLOW_WIDTH),
        row.preflight.padEnd(PREFLIGHT_WIDTH),
        row.preview,
      ].join(' ')
    )
    console.log(`${' '.repeat(ID_WIDTH)} ${request.cell} ${request.method} ${mask(request.url)}`)
  }
}

function printNotMeasured(unprobed: readonly string[], needsKey: readonly SourceId[]): void {
  console.log('\nneeds key, not measured:', needsKey.join(', ') || '-')
  console.log('route cells where no request reached the wire:', unprobed.join(', ') || '-')
}

function printVerdict(
  passing: ReadonlyMap<SourceId, boolean>,
  rows: readonly Measurement[]
): void {
  const passed = [...passing].filter(([, ok]) => ok).map(([id]) => id)
  const failed = [...passing].filter(([, ok]) => !ok).map(([id]) => id)
  const partial = failed.filter((id) =>
    rows.some(({ captured: request, cors }) => request.id === id && cors)
  )
  const stale = [...BROWSER_REACHABLE_SOURCES].filter((id) => !passed.includes(id))

  console.log('\nreachable (every measured origin passes):', passed.join(', '))
  console.log('blocked or partial:', failed.join(', '))
  console.log('partial (some origins pass):', partial.join(', ') || '-')
  console.log('in BROWSER_REACHABLE_SOURCES but not passing:', stale.join(', ') || '-')
  console.log(
    'passing but not in BROWSER_REACHABLE_SOURCES:',
    passed.filter((id) => !BROWSER_REACHABLE_SOURCES.has(id)).join(', ') || '-'
  )
}

function printRouteTable(): void {
  const browser = toBrowserRoutes(SOURCE_ROUTES, BROWSER_REACHABLE_SOURCES)

  console.log('\nbrowser route table (kind/scope: browser providers | dropped | state)')

  for (const [kind, scopes] of Object.entries(SOURCE_ROUTES)) {
    for (const [scope, ids] of Object.entries(scopes)) {
      const kept = browser[kind as SourceKind][scope] ?? []
      const dropped = ids.filter((id) => !kept.includes(id))
      const state = kept.length === 0 ? 'off' : dropped.length === 0 ? 'full' : 'reduced'

      console.log(
        `${`${kind}/${scope}`.padEnd(ID_WIDTH + HOST_WIDTH)} ${kept.join(', ') || '-'} | ${dropped.join(', ') || '-'} | ${state}`
      )
    }
  }
}

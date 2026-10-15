import { abortError, ToolError } from '@/core/errors'
import { hasLikelySecret } from '@/core/security/credentials'
import { type DnsLookupFn, defaultDnsLookup } from '@/core/ssrf/dns'
import { createPinnedFetch, type FetchFn } from '@/core/ssrf/pinned-fetch'
import { assertEndpointSafe, assertHostAllowlisted, parseHttpsUrl } from '@/core/ssrf/ssrf'

const REDIRECT_MAX = 5
// Whole-chain bound for a caller that supplies no signal of its own; a never-settling signal there
// would let one stalled hop hold its socket forever.
const GUARDED_FETCH_TIMEOUT_MS = 60_000
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'cookie2',
  'proxy-authorization',
  'proxy-authenticate',
  'x-api-key',
  'api-key',
])
// Hop-control and forwarding-identity headers: letting a caller set these lets it spoof the
// request's origin/host to the receiving app (vhost bypass, trusted-proxy IP spoofing) even though
// the connection itself is still SSRF-checked.
const FORBIDDEN_HEADER_NAMES: ReadonlySet<string> = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'forwarded',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
  'x-real-ip',
])

export type { DnsLookupFn }

interface GuardedFetchOptions {
  readonly allowlist?: readonly string[]
  readonly dnsLookup?: DnsLookupFn
}

/** A pinned request constructs its own `Response`, whose `url` is always empty — hence `finalUrl`. */
interface GuardedResponse {
  readonly response: Response
  readonly finalUrl: string
}

interface FetchHopState {
  readonly redirectsLeft: number
  readonly signal: AbortSignal
}

type FetchHopContext = FetchHopState &
  (
    | {
        readonly kind: 'remote'
        readonly allowlist: readonly string[]
        readonly dnsLookup: DnsLookupFn
      }
    | { readonly kind: 'loopback'; readonly origin: string }
  )

interface RedirectTarget {
  readonly url: URL
  readonly init: RequestInit
}

interface ResolveRedirectInput {
  readonly location: string
  readonly currentUrl: URL
  readonly init: RequestInit
  readonly ctx: FetchHopContext
}

/**
 * SSRF-guarded remote fetch. Bodyless by construction: every hop is pinned to a vetted IP, and the
 * pinned transport refuses a request body, so this path serves GET/HEAD only.
 */
async function guardedFetch(
  url: string,
  init: RequestInit,
  options?: GuardedFetchOptions
): Promise<GuardedResponse> {
  const signal = resolveFetchSignal(init)
  const parsed = parseHttpsUrl(url)

  // The signal rides the init, not just the context: the context bounds the hop loop, but only the
  // init reaches the transport, and a hop that never answers is what the bound exists for.
  return fetchHop(
    parsed,
    { ...init, signal },
    {
      kind: 'remote',
      allowlist: options?.allowlist ?? [],
      dnsLookup: options?.dnsLookup ?? defaultDnsLookup,
      redirectsLeft: REDIRECT_MAX,
      signal,
    }
  )
}

// Loopback rides native fetch, which reports its own final URL, so callers keep a plain Response.
async function guardedLoopbackFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = resolveFetchSignal(init)
  const parsed = parseLoopbackUrl(url)
  const guarded = await fetchHop(
    parsed,
    { ...init, signal },
    {
      kind: 'loopback',
      origin: parsed.origin,
      redirectsLeft: REDIRECT_MAX,
      signal,
    }
  )

  return guarded.response
}

// A body-carrying variant for transports that hand us their own fetch hook (e.g. an MCP HTTP
// client posting JSON-RPC) and so cannot ride the bodyless pinned path above. A loopback target
// reuses the loopback branch verbatim; a remote target is revalidated against the SSRF policy on
// every call — so a host that starts resolving to a blocked address is refused from the next request
// on, which a boot-time-only check never notices — then dispatched over the platform fetch, which
// resolves the name again: the check does not pin the dial, so a rebind inside that window is not
// closed. The pinned transport carries a string body only (`pinnedPublicFetch`), and a transport's
// own fetch hook may send any body. Redirects are refused outright: a configured server endpoint has no
// legitimate reason to redirect, and a manual redirect answer fails closed instead of being followed
// into an unvetted host.
async function guardedServerFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  const target = typeof url === 'string' ? url : url.toString()
  const signal = resolveFetchSignal(init)
  const requestInit: RequestInit = { ...init, signal, redirect: init.redirect ?? 'manual' }

  if (isLoopbackUrl(target)) {
    const parsed = parseLoopbackUrl(target)

    scanOutbound(parsed, requestInit)
    return fetch(parsed, requestInit)
  }

  const parsed = parseHttpsUrl(target)

  await assertEndpointSafe(parsed.toString(), signal)
  scanOutbound(parsed, requestInit)
  return fetch(parsed, requestInit)
}

async function fetchHop(
  url: URL,
  init: RequestInit,
  ctx: FetchHopContext
): Promise<GuardedResponse> {
  if (ctx.signal.aborted) {
    return Promise.reject(abortError(ctx.signal))
  }

  const response = await fetchResponse(url, init, ctx)
  const location = redirectLocation(response)

  if (location === undefined) {
    return { response, finalUrl: url.toString() }
  }

  await cancelResponseBody(response)

  if (ctx.redirectsLeft === 0) {
    throw new ToolError('host_blocked', `exceeded redirect cap of ${REDIRECT_MAX}`)
  }

  const next = resolveRedirect({ location, currentUrl: url, init, ctx })

  return fetchHop(next.url, next.init, {
    ...ctx,
    redirectsLeft: ctx.redirectsLeft - 1,
  })
}

async function fetchResponse(url: URL, init: RequestInit, ctx: FetchHopContext): Promise<Response> {
  switch (ctx.kind) {
    case 'loopback': {
      const parsed = parseLoopbackUrl(url.toString())

      scanOutbound(parsed, init)
      return fetch(parsed, { ...init, redirect: 'manual' })
    }
    case 'remote': {
      assertHostAllowlisted(ctx.allowlist, url.hostname)
      scanOutbound(url, init)

      // SSRF check re-applied on each redirect hop.
      const ip = await assertEndpointSafe(url.toString(), ctx.signal, ctx.dnsLookup)
      const pinnedFetch = createPinnedFetch(ip)
      return pinnedFetch(url.toString(), { ...init, redirect: 'manual' })
    }
    default:
      return unreachableFetchPolicy(ctx)
  }
}

function resolveRedirect(input: ResolveRedirectInput): RedirectTarget {
  const { location, currentUrl, init, ctx } = input

  switch (ctx.kind) {
    case 'loopback':
      return {
        url: parseLoopbackRedirect(location, currentUrl, ctx.origin),
        init,
      }
    case 'remote': {
      const nextUrl = parseRedirectUrl(location, currentUrl)
      // Cross-host hops drop credentialed headers before following. There is no body to drop:
      // the pinned transport refuses one, so a remote hop is always GET/HEAD.
      const nextInit = nextUrl.host !== currentUrl.host ? stripSensitiveHeaders(init) : init

      return { url: nextUrl, init: nextInit }
    }
    default:
      return unreachableFetchPolicy(ctx)
  }
}

function unreachableFetchPolicy(policy: never): never {
  throw new ToolError('unexpected', `unsupported fetch policy: ${String(policy)}`)
}

function parseLoopbackRedirect(location: string, base: URL, origin: string): URL {
  try {
    const next = parseLoopbackUrl(new URL(location, base).toString())

    if (next.origin !== origin) {
      throw new ToolError('host_blocked', 'loopback redirect changed origin')
    }

    return next
  } catch (err: unknown) {
    if (err instanceof ToolError) {
      throw err
    }

    throw new ToolError('invalid_input', 'redirect location is invalid')
  }
}

function parseRedirectUrl(location: string, base: URL): URL {
  try {
    return new URL(location, base)
  } catch {
    throw new ToolError('invalid_input', 'redirect location is invalid')
  }
}

function parseLoopbackUrl(endpoint: string): URL {
  let url: URL

  try {
    url = new URL(endpoint)
  } catch {
    throw new ToolError('host_blocked', 'malformed loopback endpoint')
  }

  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new ToolError('host_blocked', `host ${url.hostname} is not loopback`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('host_blocked', 'only HTTP or HTTPS loopback endpoints are allowed')
  }

  if (url.hostname === 'localhost') {
    url.hostname = '127.0.0.1'
  }

  return url
}

function isLoopbackUrl(endpoint: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(endpoint).hostname)
  } catch {
    return false
  }
}

function resolveFetchSignal(init: RequestInit): AbortSignal {
  if (init.signal?.aborted) {
    throw abortError(init.signal)
  }

  return init.signal ?? AbortSignal.timeout(GUARDED_FETCH_TIMEOUT_MS)
}

function redirectLocation(response: Response): string | undefined {
  if (response.status < 300 || response.status >= 400) {
    return undefined
  }

  return response.headers.get('location') ?? undefined
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

// Reject requests that would leak secret-looking values off-box (URL parts, headers, body).
function scanOutbound(url: URL, init: RequestInit): void {
  const urlParts = [
    ['URL hostname', url.hostname],
    ['URL path', url.pathname],
    ['URL username', url.username],
    ['URL password', url.password],
    ['URL query', url.search],
    // The userinfo pattern only matches the combined form, which the split parts above never carry.
    [
      'URL userinfo',
      url.password === '' ? '' : `${url.protocol}//${url.username}:${url.password}@${url.host}`,
    ],
  ] as const

  for (const [label, value] of urlParts) {
    if (value !== '') {
      assertNoSecret(label, value)
    }
  }

  if (init.headers) {
    assertNoForbiddenHeaderNames(init.headers)

    for (const value of headerValues(init.headers)) {
      assertNoSecret('header', value)
    }
  }

  const bodyText = bodyAsText(init.body)

  if (bodyText !== undefined) {
    assertNoSecret('body', bodyText)
  }
}

// Scan every body shape readable without consuming it; streams and FormData stay opaque.
function bodyAsText(body: RequestInit['body']): string | undefined {
  if (typeof body === 'string') {
    return body
  }

  if (body instanceof URLSearchParams) {
    return body.toString()
  }

  if (body instanceof Uint8Array) {
    return new TextDecoder('utf-8').decode(body)
  }

  if (body instanceof ArrayBuffer) {
    return new TextDecoder('utf-8').decode(new Uint8Array(body))
  }

  return undefined
}

function assertNoForbiddenHeaderNames(headers: NonNullable<RequestInit['headers']>): void {
  for (const [name] of headerEntries(headers)) {
    if (FORBIDDEN_HEADER_NAMES.has(name.toLowerCase())) {
      throw new ToolError('invalid_input', `header ${name} is not allowed`)
    }
  }
}

function assertNoSecret(label: string, text: string): void {
  if (hasLikelySecret(text)) {
    throw new ToolError('credential_leak', `outbound ${label} contains a secret pattern`)
  }
}

function headerValues(headers: NonNullable<RequestInit['headers']>): readonly string[] {
  return headerEntries(headers).map(([, value]) => value)
}

function stripSensitiveHeaders(init: RequestInit): RequestInit {
  if (!init.headers) {
    return init
  }

  const kept: [string, string][] = headerEntries(init.headers).filter(
    ([key]) => !SENSITIVE_HEADERS.has(key.toLowerCase())
  )

  return { ...init, headers: kept }
}

// Normalize the three HeadersInit shapes (Headers | tuple array | record) to entries.
function headerEntries(
  headers: NonNullable<RequestInit['headers']>
): ReadonlyArray<[string, string]> {
  if (headers instanceof Headers) {
    return [...headers.entries()]
  }

  if (Array.isArray(headers)) {
    return headers.filter(
      (e): e is [string, string] => typeof e[0] === 'string' && typeof e[1] === 'string'
    )
  }

  return Object.entries(headers).filter((e): e is [string, string] => typeof e[1] === 'string')
}

/** One request's fetch for a caller that must send a body or a bearer key: the host is resolved
 *  and vetted now, and the dial goes to that address, so a rebind before the request lands on
 *  nothing. No redirect is followed. */
async function pinnedPublicFetch(url: string, signal: AbortSignal): Promise<FetchFn> {
  const ip = await assertEndpointSafe(parseHttpsUrl(url).toString(), signal)

  return createPinnedFetch(ip, { allowBody: true })
}

export const NetworkPolicy = {
  pinnedPublicFetch,
  guardedFetch,
  guardedLoopbackFetch,
  guardedServerFetch,
  isLoopbackUrl,
} as const

import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceFacts, SourceRequest } from '@/trading/sources/types'
import { OperatorConfigError } from '@/core/config/resolve'
import { BROWSER_HEADERS, USER_AGENT } from '@/core/http-client'

const TRAILING_SLASH_RE = /\/$/

export interface RequestTarget {
  readonly hosts: readonly string[]
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
}

export interface PreparedRequest {
  readonly query?: Readonly<Record<string, string>>
  readonly headers?: Readonly<Record<string, string>>
}

export interface EndpointMaps {
  readonly hosts: ReadonlyMap<SourceId, readonly string[]>
  readonly basePaths: ReadonlyMap<SourceId, string>
}

// `hosts` is the origin (the trusted-host list); `basePaths` is the endpoint's own path prefix,
// such as CoinGecko's `/api/v3`. Keeping only the origin would drop that prefix from every request.
export function buildEndpointMaps(
  endpoints: Readonly<Partial<Record<SourceId, string | readonly string[]>>>
): EndpointMaps {
  const hosts = new Map<SourceId, readonly string[]>()
  const basePaths = new Map<SourceId, string>()

  for (const [id, endpoint] of Object.entries(endpoints)) {
    if (endpoint === undefined) {
      continue
    }

    const list = Array.isArray(endpoint) ? endpoint : [endpoint]
    // why-safe: the endpoint record is keyed by SourceId; Object.entries widens the key.
    const key = id as SourceId

    hosts.set(
      key,
      list.map((entry) => new URL(entry).origin)
    )
    const base = new URL(list[0]).pathname
    basePaths.set(key, base === '/' ? '' : base.replace(TRAILING_SLASH_RE, ''))
  }

  return { hosts, basePaths }
}

// One call targets one host: either the provider's registered endpoint, or — for a feed-based
// provider — the allowlisted feed URL named by `feedId`. Anything else is unroutable and reported
// as unavailable rather than fetched.
export function resolveTarget(
  facts: SourceFacts,
  endpoints: EndpointMaps,
  request: SourceRequest
): RequestTarget | null {
  if (request.feedId !== undefined) {
    const feedUrl = facts.feeds[request.feedId]

    if (feedUrl === undefined) {
      return null
    }

    const url = new URL(feedUrl)
    const query = Object.fromEntries(url.searchParams)

    return {
      hosts: [url.origin],
      path: url.pathname,
      ...(Object.keys(query).length === 0 ? {} : { query }),
    }
  }

  const requestHosts = endpoints.hosts.get(request.sourceId)

  if (requestHosts === undefined) {
    return null
  }

  return {
    hosts: requestHosts,
    path: `${endpoints.basePaths.get(request.sourceId) ?? ''}${request.path}`,
    ...(request.query ? { query: request.query } : {}),
  }
}

// The wire-ready request: who we say we are, plus the secret where one is declared. The raw secret
// exists only here — never returned to an adapter, logged, placed in provenance, or exposed in a
// summary. A declared credential with no secret is a config defect unless it is optional.
export function prepareOutbound(
  facts: SourceFacts,
  request: SourceRequest,
  target: RequestTarget
): PreparedRequest {
  const headers = { ...identityFor(facts, request.sourceId), ...request.headers }
  const base: PreparedRequest = {
    ...(target.query ? { query: target.query } : {}),
    headers,
  }

  if (!request.credential) {
    return base
  }

  const secret = facts.credentials[request.sourceId]

  if (secret === undefined && request.credential.optional) {
    return base
  }

  if (secret === undefined) {
    throw new OperatorConfigError(`source ${request.sourceId} requires a credential`, {
      key: 'errors.sourceCredentialMissing',
      params: { source: request.sourceId },
    })
  }

  if (request.credential.kind === 'query') {
    return { ...base, query: { ...target.query, [request.credential.name]: secret } }
  }

  const value = `${request.credential.prefix ?? ''}${secret}`

  return { ...base, headers: { ...headers, [request.credential.name]: value } }
}

function identityFor(facts: SourceFacts, id: SourceId): Readonly<Record<string, string>> {
  return facts.plainUserAgentSources.has(id) ? { 'user-agent': USER_AGENT } : BROWSER_HEADERS
}

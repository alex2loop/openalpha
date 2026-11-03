import type { Captured, Measurement } from './types'

export const PAGE_ORIGIN = 'https://openalpha.example'

const REQUEST_TIMEOUT_MS = 15_000
const MAX_REDIRECTS = 5
const PREVIEW_CHARS = 48
// A request that follows a redirect to another origin is tainted: the browser sends `Origin: null`.
const TAINTED_ORIGIN = 'null'
const PREFLIGHT_NOT_NEEDED = 'not needed'
const PREFLIGHT_PASS = 'pass'
const PREFLIGHT_FAIL = 'FAIL'
const NO_VALUE = '-'
const SUCCESS_MIN = 200
const SUCCESS_MAX = 300
// Request headers a page may send without a preflight (the CORS-safelisted names the transport can
// produce); `content-type` is judged by its value.
const SIMPLE_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-language',
])
const SIMPLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/x-www-form-urlencoded',
  'multipart/form-data',
  'text/plain',
])
const SIMPLE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST'])
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308])
const WHITESPACE_RE = /\s+/g

interface Hop {
  readonly status: number
  readonly allowOrigin: string
  readonly cors: boolean
  readonly preview: string
}

/** What the request came to: the last hop it reached (none for a POST, which is not sent) and
 *  whether every step passed. */
interface Reading {
  readonly last?: Hop
  readonly cors: boolean
}

/** Parallel across providers, in turn within one: a host's own requests never arrive together. */
export async function measureAll(requests: readonly Captured[]): Promise<readonly Measurement[]> {
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

async function measure(request: Captured): Promise<Measurement> {
  const preflight = needsPreflight(request) ? await sendPreflight(request) : PREFLIGHT_NOT_NEEDED
  const preflightOk = preflight === PREFLIGHT_NOT_NEEDED || preflight.startsWith(PREFLIGHT_PASS)

  if (request.method !== 'GET') {
    return outcomeOf(request, preflight, { cors: preflightOk })
  }

  try {
    const hops = await followRedirects(request)
    const last = hops[hops.length - 1]

    return outcomeOf(request, preflight, {
      ...(last === undefined ? {} : { last }),
      cors: preflightOk && hops.every(({ cors }) => cors),
    })
  } catch (err: unknown) {
    return {
      captured: request,
      status: 'error',
      allowOrigin: NO_VALUE,
      preflight,
      cors: false,
      preview: err instanceof Error ? err.message : String(err),
    }
  }
}

function needsPreflight(request: Captured): boolean {
  const contentType = request.headers['content-type']

  return (
    !SIMPLE_METHODS.has(request.method) ||
    Object.keys(request.headers).some(isUnsafeHeaderName) ||
    (contentType !== undefined && !SIMPLE_CONTENT_TYPES.has(contentType.split(';')[0] ?? ''))
  )
}

function isUnsafeHeaderName(name: string): boolean {
  return !SIMPLE_HEADERS.has(name) && name !== 'content-type'
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
    const isSuccess = res.status >= SUCCESS_MIN && res.status < SUCCESS_MAX
    const ok = isSuccess && allowsOrigin(res.headers, PAGE_ORIGIN) && headersOk

    return `${ok ? PREFLIGHT_PASS : PREFLIGHT_FAIL} ${res.status}`
  } catch (err: unknown) {
    return `${PREFLIGHT_FAIL} ${err instanceof Error ? err.name : 'error'}`
  }
}

async function followRedirects(request: Captured): Promise<readonly Hop[]> {
  const hops: Hop[] = []
  let url = request.url
  let origin = PAGE_ORIGIN

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...request.headers, origin },
    })
    const location = res.headers.get('location')

    hops.push({
      status: res.status,
      allowOrigin: res.headers.get('access-control-allow-origin') ?? NO_VALUE,
      cors: allowsOrigin(res.headers, origin),
      preview: await firstBytes(res),
    })

    if (!REDIRECT_STATUSES.has(res.status) || location === null) {
      return hops
    }

    const next = new URL(location, url)

    origin = next.origin === new URL(url).origin ? origin : TAINTED_ORIGIN
    url = next.href
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
    const text = new TextDecoder().decode(value).replace(WHITESPACE_RE, ' ')

    return text.slice(0, PREVIEW_CHARS)
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}

function allowsOrigin(headers: Headers, origin: string): boolean {
  const allow = headers.get('access-control-allow-origin')

  return allow === '*' || allow === origin
}

function outcomeOf(request: Captured, preflight: string, reading: Reading): Measurement {
  const { last, cors } = reading

  return {
    captured: request,
    status: last === undefined ? 'not sent' : String(last.status),
    allowOrigin: last?.allowOrigin ?? NO_VALUE,
    preflight,
    cors,
    preview: last?.preview ?? 'POST not sent',
  }
}

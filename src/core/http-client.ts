import type { ToolErrorCode } from '@/core/errors'
import type { FetchFn } from '@/core/ssrf/pinned-fetch'
import { BRAND } from '@/core/brand'
import { abortError, ToolError } from '@/core/errors'
import { MS_PER_SECOND } from '@/core/utils/time'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_MAX_BYTES = 2_097_152 // 2 MiB
const DEFAULT_ACCEPT = 'application/json'
const NO_ERROR_BODY_STATUSES: readonly number[] = Object.freeze([])

/** What this process is, said plainly. Only for a provider that refuses a browser: FRED's edge
 *  resets the stream for one, which is a dead connection rather than a status to fail over on. */
export const USER_AGENT = `${BRAND.name}/${BRAND.version} Bun/${Bun.version}`

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** The default identity for an outbound request. A bot manager reads more than the agent string, so
 *  the language header travels with it: a browser that states neither is the shape those gates
 *  fingerprint. Probed against every provider host both ways — none refuses it but FRED, and it is
 *  the faster answer on nine of them, `home.treasury.gov` by 18,0s against 1,7s. */
export const BROWSER_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'user-agent': BROWSER_USER_AGENT,
  'accept-language': 'en-US,en;q=0.9',
})
const DELTA_SECONDS_RE = /^\d+$/
// Month and day stay loose: RFC 7231 prefers `21 Oct 2025`, but servers do send `21 October 2025`
// and a single-digit day, and rejecting those drops the back-off hint entirely.
const HTTP_DATE_RE = /^[^\s]+,\s*\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/

export function parseRetryAfterMs(
  header: string | null | undefined,
  nowMs: number,
  maxMs: number
): number | undefined {
  if (header === null || header === undefined) {
    return undefined
  }

  const value = header.trim()
  const boundedMaxMs = Number.isFinite(maxMs) ? Math.max(0, maxMs) : 0

  if (DELTA_SECONDS_RE.test(value)) {
    return Math.min(Number(value) * MS_PER_SECOND, boundedMaxMs)
  }

  if (HTTP_DATE_RE.test(value)) {
    const at = Date.parse(value)

    if (!Number.isFinite(at)) {
      return undefined
    }

    return Math.min(Math.max(0, at - nowMs), boundedMaxMs)
  }

  return undefined
}

export class HttpRequestError extends ToolError {
  readonly status: number | undefined
  readonly retryAfter: string | undefined

  constructor(
    code: ToolErrorCode,
    message: string,
    options?: {
      readonly status: number | undefined
      readonly retryAfter: string | undefined
      readonly cause?: unknown
    }
  ) {
    super(code, message, options?.cause)
    this.status = options?.status
    this.retryAfter = options?.retryAfter
  }
}

interface HttpRequestOptions {
  hosts: readonly string[] // fixed, caller-supplied (trusted) ⇒ no SSRF guard; tried in order
  path: string
  method?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  body?: string
  maxBytes?: number
  /** Non-2xx statuses whose body is the answer rather than a failure: returned as a response and
   *  never failed over, because another host would give the same refusal. */
  errorBodyStatuses?: readonly number[]
  timeoutMs?: number
  /** Deadline per host inside `signal`: a host that spends it fails alone and the next is tried. */
  hostTimeoutMs?: number
  signal: AbortSignal
  fetchImpl?: FetchFn // injectable for tests/observability; defaults to global fetch
}

interface HttpResponse {
  status: number
  headers: Headers
  text: string
}

interface KeylessGetOptions {
  hosts: readonly string[] // fixed, caller-supplied (never user) => no SSRF; tried in order
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  maxBytes?: number
  signal: AbortSignal
  toolName: string
}

type FixedHostRequest = (req: Omit<HttpRequestOptions, 'timeoutMs'>) => Promise<HttpResponse>

interface HttpAttemptContext {
  doFetch: FetchFn
  init: RequestInit
  maxBytes: number
  errorBodyStatuses: readonly number[]
  callerSignal: AbortSignal
  timeoutSignal?: AbortSignal
  hostSignal?: AbortSignal
}

type Attempt =
  | { ok: true; res: HttpResponse }
  | {
      ok: false
      error: string
      status: number | undefined
      retryAfter: string | undefined
      code?: ToolErrorCode
      timeout?: Error
    }

// GET/POST a fixed trusted-host endpoint under one shared timeout, falling over to the next
// host on network failure / non-2xx, with a size cap. Redirects are not followed: a 3xx fails
// the attempt like any other non-2xx. Not for streaming (LLM) or user-supplied URLs — those go
// through NetworkPolicy.guardedFetch (SSRF-guarded).
export async function httpRequest(req: HttpRequestOptions): Promise<HttpResponse> {
  if (req.signal.aborted) {
    return Promise.reject(abortError(req.signal))
  }

  const timeoutSignal = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = AbortSignal.any([req.signal, timeoutSignal])

  return await requestHosts(req, signal, timeoutSignal)
}

// Fixed-host callers that already own a whole-operation deadline use this path so one composed
// signal governs network I/O, retry backoff, and throttling without arming a second timeout.
export async function httpRequestWithSignal(
  req: Omit<HttpRequestOptions, 'timeoutMs'>
): Promise<HttpResponse> {
  if (req.signal.aborted) {
    return Promise.reject(abortError(req.signal))
  }

  return await requestHosts(req, req.signal)
}

async function requestHosts(
  req: Omit<HttpRequestOptions, 'timeoutMs'>,
  signal: AbortSignal,
  timeoutSignal?: AbortSignal
): Promise<HttpResponse> {
  const doFetch: FetchFn =
    req.fetchImpl ?? ((u: string | URL, i?: RequestInit) => globalThis.fetch(u, i))
  const init = buildInit(req, signal)
  const ctx: HttpAttemptContext = {
    doFetch,
    init,
    maxBytes: req.maxBytes ?? DEFAULT_MAX_BYTES,
    errorBodyStatuses: req.errorBodyStatuses ?? NO_ERROR_BODY_STATUSES,
    callerSignal: req.signal,
    ...(timeoutSignal === undefined ? {} : { timeoutSignal }),
  }

  let lastErr: Extract<Attempt, { ok: false }> = {
    ok: false,
    error: 'no response',
    status: undefined,
    retryAfter: undefined,
  }
  for (const host of req.hosts) {
    const attempt = await attemptHost(
      withHostTimeout(ctx, req.hostTimeoutMs),
      buildUrl(host, req.path, req.query)
    )

    if (attempt.ok) {
      return attempt.res
    }

    lastErr = attempt
  }

  // The last host spent its own deadline: surface the TimeoutError itself, as a lone host does.
  if (lastErr.timeout !== undefined) {
    throw lastErr.timeout
  }

  throw new HttpRequestError(lastErr.code ?? 'unexpected', `request failed (${lastErr.error})`, {
    status: lastErr.status,
    retryAfter: lastErr.retryAfter,
  })
}

function withHostTimeout(ctx: HttpAttemptContext, hostTimeoutMs?: number): HttpAttemptContext {
  if (hostTimeoutMs === undefined) {
    return ctx
  }

  const hostSignal = AbortSignal.timeout(hostTimeoutMs)
  const signal = AbortSignal.any([ctx.init.signal ?? ctx.callerSignal, hostSignal])

  return { ...ctx, init: { ...ctx.init, signal }, hostSignal }
}

// GET a keyless fixed-host endpoint and return raw text. Thin wrapper over httpRequestWithSignal.
export async function keylessGetWithSignal(req: KeylessGetOptions): Promise<string> {
  return await requestKeyless(req, httpRequestWithSignal)
}

async function requestKeyless(req: KeylessGetOptions, request: FixedHostRequest): Promise<string> {
  try {
    const res = await request({
      hosts: req.hosts,
      path: req.path,
      signal: req.signal,
      // Conditional spreads keep absent keys out (exactOptionalPropertyTypes): assigning
      // `query: undefined` would widen the optional prop and fail the type gate.
      ...(req.query !== undefined ? { query: req.query } : {}),
      ...(req.headers !== undefined ? { headers: req.headers } : {}),
      ...(req.maxBytes !== undefined ? { maxBytes: req.maxBytes } : {}),
    })

    return res.text
  } catch (err: unknown) {
    if (err instanceof HttpRequestError) {
      throw new HttpRequestError(err.code, `${req.toolName}: ${err.message}`, {
        status: err.status,
        retryAfter: err.retryAfter,
        cause: err,
      })
    }
    throw err
  }
}

function buildInit(req: Omit<HttpRequestOptions, 'timeoutMs'>, signal: AbortSignal): RequestInit {
  const init: RequestInit = {
    method: req.method ?? 'GET',
    headers: { accept: DEFAULT_ACCEPT, ...BROWSER_HEADERS, ...req.headers },
    signal,
    redirect: 'manual',
  }

  // Same exactOptionalPropertyTypes reason as keylessGet: omit the key when there's no body.
  if (req.body !== undefined) {
    init.body = req.body
  }

  return init
}

async function attemptHost(ctx: HttpAttemptContext, url: URL): Promise<Attempt> {
  try {
    const res = await ctx.doFetch(url, ctx.init)

    await assertResponseActive(ctx, url, res)
    const attempt = await consumeResponse(res, ctx)

    assertAttemptActive(ctx, url)
    return attempt
  } catch (err: unknown) {
    // Abort and whole-request timeout end the request above; anything left describes this host
    // alone, so it fails the attempt and the loop tries the next one. An injected transport that
    // reports failures as ToolError gets the same failover as the default one.
    assertAttemptActive(ctx, url)

    if (ctx.hostSignal?.aborted === true) {
      return {
        ok: false,
        error: `request timed out: ${url.host}`,
        status: undefined,
        retryAfter: undefined,
        code: 'timeout',
        timeout: abortError(ctx.hostSignal),
      }
    }

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: undefined,
      retryAfter: undefined,
    }
  }
}

async function assertResponseActive(
  ctx: HttpAttemptContext,
  url: URL,
  res: Response
): Promise<void> {
  if (ctx.callerSignal.aborted || ctx.timeoutSignal?.aborted === true) {
    await cancelResponseBody(res)
    assertAttemptActive(ctx, url)
  }
}

function assertAttemptActive(ctx: HttpAttemptContext, url: URL): void {
  if (ctx.callerSignal.aborted) {
    throw abortError(ctx.callerSignal)
  }

  if (ctx.timeoutSignal?.aborted === true) {
    throw new ToolError('timeout', `request timed out: ${url.host}`)
  }
}

async function consumeResponse(
  res: Response,
  ctx: Pick<HttpAttemptContext, 'maxBytes' | 'errorBodyStatuses'>
): Promise<Attempt> {
  if (!(res.ok || ctx.errorBodyStatuses.includes(res.status))) {
    const retryAfter = res.headers.get('retry-after') ?? undefined
    await cancelResponseBody(res)

    return {
      ok: false,
      error: `HTTP ${res.status}`,
      status: res.status,
      retryAfter,
    }
  }

  const contentLength = Number(res.headers.get('content-length') ?? '0')

  if (contentLength > ctx.maxBytes) {
    await cancelResponseBody(res)

    return oversized(ctx.maxBytes)
  }

  // A cap breach fails this host like any other bad response, so the loop still tries the next one.
  try {
    const text = await readCappedText(res, ctx.maxBytes)

    return { ok: true, res: { status: res.status, headers: res.headers, text } }
  } catch (err: unknown) {
    if (err instanceof ToolError && err.code === 'payload_too_large') {
      return oversized(ctx.maxBytes)
    }

    throw err
  }
}

function oversized(maxBytes: number): Attempt {
  return {
    ok: false,
    error: `response too large (>${maxBytes} bytes)`,
    status: undefined,
    retryAfter: undefined,
    code: 'payload_too_large',
  }
}

async function cancelResponseBody(res: Response): Promise<void> {
  await res.body?.cancel().catch(() => undefined)
}

function buildUrl(host: string, path: string, query?: Record<string, string>): URL {
  const url = new URL(`${host}${path}`)

  // Concatenation lets a path re-target the request: a leading `@` makes the host userinfo, and a
  // missing leading `/` glues onto the hostname. The origin must survive it.
  if (url.origin !== new URL(host).origin) {
    throw new ToolError('invalid_input', `path must stay within ${host}: ${path}`)
  }

  for (const [k, v] of Object.entries(query ?? {})) {
    url.searchParams.set(k, v)
  }

  return url
}

interface CappedText {
  readonly text: string
  readonly truncated: boolean
}

// Streaming byte-capped reader: cancels the reader the moment the running total exceeds the cap,
// then decodes the buffered bytes as UTF-8. Counts bytes, not chars.
export async function readCappedText(res: Response, maxBytes: number): Promise<string> {
  return (await readCapped(res, maxBytes, 'reject')).text
}

// Same cap, but a longer body yields its first maxBytes bytes and truncated: true, with a
// multibyte character cut by the cap dropped instead of decoded to U+FFFD.
export function readTruncatedText(res: Response, maxBytes: number): Promise<CappedText> {
  return readCapped(res, maxBytes, 'truncate')
}

async function readCapped(
  res: Response,
  maxBytes: number,
  overflow: 'reject' | 'truncate'
): Promise<CappedText> {
  const reader = res.body?.getReader()

  if (reader === undefined) {
    return { text: '', truncated: false }
  }

  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      if (total + value.byteLength > maxBytes) {
        if (overflow === 'reject') {
          throw new ToolError('payload_too_large', `response too large (>${maxBytes} bytes)`)
        }

        chunks.push(value.subarray(0, maxBytes - total))
        truncated = true
        break
      }

      total += value.byteLength
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }

  return {
    text: new TextDecoder('utf-8').decode(Buffer.concat(chunks), { stream: truncated }),
    truncated,
  }
}

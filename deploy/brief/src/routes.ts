import {
  PUBLIC_BRIEF_WIRE_SCHEMA,
  type PublishAnswer,
} from '../../../src/app/server/wire/public-brief'
import { isDocument } from '../../../src/app/server/wire/public-brief-document'
import { sendDayPushes } from './push'
import { claimPush, findLatestBody, MS_PER_DAY, saveBrief } from './store'
import {
  countSubscriptions,
  deleteSubscription,
  MAX_SUBSCRIBE_BYTES,
  SUBSCRIPTION_CAP,
  saveSubscription,
  toPushEndpoint,
} from './subscriptions'

const PUBLISH_PATH = '/api/publish'
const SUBSCRIBE_PATH = '/api/subscribe'
const UNSUBSCRIBE_PATH = '/api/unsubscribe'
const LATEST_PATH = '/api/latest'
const API_PREFIX = '/api/'
const MAX_PUBLISH_BYTES = 262_144
const LATEST_MAX_AGE_SECONDS = 60
const MAX_DAYS_BACK = 7
const MAX_DAYS_AHEAD = 1
const BEARER_RE = /^Bearer (.+)$/i
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
}

export interface Env {
  readonly DB: D1Database
  readonly PUBLISH_TOKEN: string
  readonly VAPID_PRIVATE_KEY: string
  readonly ASSETS: Fetcher
}

// The one boundary for a store or stream failure: the caller gets a keyed answer to retry on, never
// the platform's page, and nothing of the body or the token is kept.
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  try {
    return await route(request, env, ctx)
  } catch {
    return replyJson(503, { error: 'unavailable' })
  }
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === PUBLISH_PATH) {
    return request.method === 'POST' ? publish(request, env, ctx) : replyNotAllowed('POST')
  }

  if (pathname === SUBSCRIBE_PATH) {
    return request.method === 'POST' ? subscribe(request, env) : replyNotAllowed('POST')
  }

  if (pathname === UNSUBSCRIBE_PATH) {
    return request.method === 'POST' ? unsubscribe(request, env) : replyNotAllowed('POST')
  }

  if (pathname === LATEST_PATH) {
    return request.method === 'GET' ? serveLatest(request, env) : replyNotAllowed('GET')
  }

  if (pathname.startsWith(API_PREFIX)) {
    return replyJson(404, { error: 'not-found' })
  }

  return env.ASSETS.fetch(request)
}

async function publish(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!(await isAuthorized(request, env.PUBLISH_TOKEN))) {
    return replyJson(401, { error: 'unauthorized' })
  }

  const body = await readBody(request, MAX_PUBLISH_BYTES)

  if (body === undefined) {
    return replyJson(413, { error: 'too-large' })
  }

  const now = Date.now()
  const document = jsonOrUndefined(body)

  if (!(isDocument(document) && isPlausibleDay(document.day, now))) {
    return replyJson(400, { error: 'invalid' })
  }

  const saved = await saveBrief(env.DB, {
    day: document.day,
    schema: PUBLIC_BRIEF_WIRE_SCHEMA,
    body,
    publishedAt: now,
  })

  if (saved === 'conflict') {
    return replyJson(409, { error: 'conflict' })
  }

  const stored = saved === 'inserted'

  if (stored) {
    await bestEffort(caches.default.delete(latestKeyOf(request)))
  }

  await pushDay(env, ctx, { day: document.day, now })

  // The hint is best effort: a failed count answers without `full` and never fails a stored day.
  const held = await bestEffort(countSubscriptions(env.DB))
  const answer: PublishAnswer =
    held !== undefined && held >= SUBSCRIPTION_CAP ? { stored, full: true } : { stored }

  return replyJson(stored ? 201 : 200, answer)
}

// A day that is held, new or repeated, is pushed once: the claim goes to the first caller, so a
// publish whose first run died after its insert still pushes, and a late older day never does. The
// sends run after the answer. Without the key nothing is claimed, so the day waits for one.
async function pushDay(
  env: Env,
  ctx: ExecutionContext,
  brief: { day: string; now: number }
): Promise<void> {
  if (!(env.VAPID_PRIVATE_KEY && (await claimPush(env.DB, brief.day, brief.now)))) {
    return
  }

  ctx.waitUntil(sendDayPushes(env.DB, env.VAPID_PRIVATE_KEY, brief.now))
}

async function subscribe(request: Request, env: Env): Promise<Response> {
  const endpoint = await readEndpoint(request)

  if (endpoint instanceof Response) {
    return endpoint
  }

  const saved = await saveSubscription(env.DB, endpoint, Date.now())

  return saved === 'saved'
    ? replyJson(200, { subscribed: true })
    : replyJson(503, { error: 'full' })
}

async function unsubscribe(request: Request, env: Env): Promise<Response> {
  const endpoint = await readEndpoint(request)

  if (endpoint instanceof Response) {
    return endpoint
  }

  await deleteSubscription(env.DB, endpoint)

  return replyJson(200, { subscribed: false })
}

// The guards both subscription calls share, in order: the app's own origin, the size, then the
// push address. The answer is the refusal when there is one.
async function readEndpoint(request: Request): Promise<string | Response> {
  if (!isSameOrigin(request)) {
    return replyJson(403, { error: 'forbidden' })
  }

  const body = await readBody(request, MAX_SUBSCRIBE_BYTES)

  if (body === undefined) {
    return replyJson(413, { error: 'too-large' })
  }

  return toPushEndpoint(jsonOrUndefined(body)) ?? replyJson(400, { error: 'invalid' })
}

// Only the app's own page may subscribe: a browser sends its `Origin` on a cross-site post, so a
// missing or foreign one is refused.
function isSameOrigin(request: Request): boolean {
  return request.headers.get('Origin') === new URL(request.url).origin
}

// The edge cache answers first, so a flood of reads costs no store read. An empty store is not kept.
// The cache only saves reads: a failure of it falls through to the store and never fails an answer.
async function serveLatest(request: Request, env: Env): Promise<Response> {
  const key = latestKeyOf(request)
  const kept = await bestEffort(caches.default.match(key))

  if (kept !== undefined) {
    return kept
  }

  const body = await findLatestBody(env.DB, PUBLIC_BRIEF_WIRE_SCHEMA)

  if (body === undefined) {
    return replyJson(404, { error: 'empty' })
  }

  const response = replyBody(200, body, {
    'Cache-Control': `public, max-age=${LATEST_MAX_AGE_SECONDS}`,
  })

  await bestEffort(caches.default.put(key, response.clone()))

  return response
}

// A failed cache call answers undefined: a purge that failed leaves the old answer for at most its
// max-age, and the stored publish or the good read stands.
async function bestEffort<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work
  } catch {
    return undefined
  }
}

// One entry whatever the query string, so a changing `?x=` cannot walk around the cache.
function latestKeyOf(request: Request): Request {
  return new Request(new URL(LATEST_PATH, request.url))
}

// Both sides are hashed first, so the comparison is over equal-length digests whatever the
// presented token's length, and a missing secret never matches a missing token.
async function isAuthorized(request: Request, token: string): Promise<boolean> {
  if (!token) {
    return false
  }

  const presented = BEARER_RE.exec(request.headers.get('Authorization') ?? '')?.[1] ?? ''
  const [expected, actual] = await Promise.all([digestOf(token), digestOf(presented)])

  return crypto.subtle.timingSafeEqual(expected, actual)
}

function digestOf(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
}

// The body as text, or undefined once it runs past the limit: declared, or counted while reading.
async function readBody(request: Request, maxBytes: number): Promise<string | undefined> {
  if (Number(request.headers.get('Content-Length')) > maxBytes) {
    return undefined
  }

  return readCapped(request.body, maxBytes)
}

// A chunked upload carries no Content-Length, so the limit is also held while reading.
async function readCapped(
  stream: ReadableStream<Uint8Array<ArrayBuffer>> | null,
  maxBytes: number
): Promise<string | undefined> {
  if (stream === null) {
    return ''
  }

  const reader = stream.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let size = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) {
      return new Blob(chunks).text()
    }

    size += value.byteLength

    if (size > maxBytes) {
      await reader.cancel()

      return undefined
    }

    chunks.push(value)
  }
}

// A real calendar date (`isDocument` holds the format) from a week back to a day ahead of the
// Worker's UTC today (a Vietnam morning is already tomorrow in UTC): a far-future day would pin
// `latest` for good, and a far-past one only fills the store.
function isPlausibleDay(day: string, now: number): boolean {
  const start = Date.parse(`${day}T00:00:00Z`)

  if (Number.isNaN(start) || !new Date(start).toISOString().startsWith(day)) {
    return false
  }

  const daysFromToday = (start - Math.floor(now / MS_PER_DAY) * MS_PER_DAY) / MS_PER_DAY

  return daysFromToday >= -MAX_DAYS_BACK && daysFromToday <= MAX_DAYS_AHEAD
}

function jsonOrUndefined(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON is a 400 for the caller to read, not a failure of the Worker.
    return undefined
  }
}

function replyNotAllowed(allowed: string): Response {
  return replyJson(405, { error: 'method-not-allowed' }, { Allow: allowed })
}

function replyJson(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return replyBody(status, JSON.stringify(value), headers)
}

// Every answer is JSON, hardened and uncached unless its own headers say otherwise. There is no
// CORS header anywhere: only the app's own origin reads the API.
function replyBody(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

import type { PublicBriefDocument, PublishAnswer } from '../../../src/app/server/wire/public-brief'
import { findLatestBody, saveBrief } from './store'

export interface Env {
  readonly DB: D1Database
  readonly PUBLISH_TOKEN: string
  readonly ASSETS: Fetcher
}

const PUBLISH_PATH = '/api/publish'
const LATEST_PATH = '/api/latest'
const API_PREFIX = '/api/'
const MAX_PUBLISH_BYTES = 262_144
const LATEST_MAX_AGE_SECONDS = 60
const DAY_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const BEARER_RE = /^Bearer (.+)$/i
const SCHEMA_VERSION = 1
const LOCALES: readonly (keyof PublicBriefDocument['briefs'])[] = ['vi', 'en']
const NO_SUBSCRIBERS = 0
const NO_REJECTED = 0
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)

  if (pathname === PUBLISH_PATH) {
    return request.method === 'POST' ? publish(request, env) : replyNotAllowed('POST')
  }

  if (pathname === LATEST_PATH) {
    return request.method === 'GET' ? latest(env) : replyNotAllowed('GET')
  }

  if (pathname.startsWith(API_PREFIX)) {
    return replyJson(404, { error: 'not-found' })
  }

  return env.ASSETS.fetch(request)
}

async function publish(request: Request, env: Env): Promise<Response> {
  if (!(await isAuthorized(request, env.PUBLISH_TOKEN))) {
    return replyJson(401, { error: 'unauthorized' })
  }

  if (Number(request.headers.get('Content-Length')) > MAX_PUBLISH_BYTES) {
    return replyJson(413, { error: 'too-large' })
  }

  const body = await readCapped(request.body)

  if (body === undefined) {
    return replyJson(413, { error: 'too-large' })
  }

  const day = readPublishedDay(body)

  if (day === undefined) {
    return replyJson(400, { error: 'invalid' })
  }

  const saved = await saveBrief(env.DB, {
    day,
    schema: SCHEMA_VERSION,
    body,
    publishedAt: Date.now(),
  })

  if (saved === 'conflict') {
    return replyJson(409, { error: 'conflict' })
  }

  const stored = saved === 'inserted'
  const answer: PublishAnswer = { stored, subscribers: NO_SUBSCRIBERS, rejected: NO_REJECTED }

  return replyJson(stored ? 201 : 200, answer)
}

async function latest(env: Env): Promise<Response> {
  const body = await findLatestBody(env.DB)

  if (body === undefined) {
    return replyJson(404, { error: 'empty' })
  }

  return respond(200, body, { 'Cache-Control': `public, max-age=${LATEST_MAX_AGE_SECONDS}` })
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

// The body as text, or undefined once it runs past the limit: a chunked upload carries no
// Content-Length, so the limit is also held while reading.
async function readCapped(
  stream: ReadableStream<Uint8Array<ArrayBuffer>> | null
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

    if (size > MAX_PUBLISH_BYTES) {
      await reader.cancel()

      return undefined
    }

    chunks.push(value)
  }
}

function readPublishedDay(body: string): PublicBriefDocument['day'] | undefined {
  const document = parseJson(body)

  if (!isRecord(document) || document.schema !== SCHEMA_VERSION) {
    return undefined
  }

  const { day, briefs, screens } = document

  if (typeof day !== 'string' || !DAY_RE.test(day) || !isRecord(briefs) || !isRecord(screens)) {
    return undefined
  }

  return LOCALES.every((locale) => isRecord(briefs[locale]) && Array.isArray(screens[locale]))
    ? day
    : undefined
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Not JSON is a 400 for the caller to read, not a failure of the Worker.
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function replyNotAllowed(allowed: string): Response {
  return replyJson(405, { error: 'method-not-allowed' }, { Allow: allowed })
}

function replyJson(status: number, value: unknown, headers: Record<string, string> = {}): Response {
  return respond(status, JSON.stringify(value), headers)
}

// Every answer is JSON, hardened and uncached unless its own headers say otherwise. There is no
// CORS header anywhere: only the app's own origin reads the API.
function respond(status: number, body: string, headers: Record<string, string> = {}): Response {
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

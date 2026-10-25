import type { ApiErrorCode } from '@/app/server/wire/errors'
import type { RouteDef } from '@/web/api/routes'
import { authState, clearToken, readToken } from '@/web/api/token'

const REQUEST_TIMEOUT_MS = 20_000
const UNAUTHORIZED_STATUS = 401
// A request that got no answer has no HTTP status.
const NO_STATUS = 0
const JSON_CONTENT_TYPE = 'application/json'
// Exhaustive by `satisfies`, so a code added to the wire fails the typecheck until it is listed.
const API_ERROR_CODES = Object.freeze({
  unauthorized: true,
  forbidden: true,
  not_found: true,
  invalid_body: true,
  conflict: true,
  price_unconfirmed: true,
  upstream_failed: true,
  too_many_streams: true,
  unavailable: true,
  timeout: true,
  internal: true,
} satisfies Record<ApiErrorCode, true>)

/** `generic` is a code this page does not know, from a newer daemon. */
type FailureCode = ApiErrorCode | 'unreachable' | 'timeout' | 'bad_response' | 'generic'

interface GetInit {
  readonly query?: Readonly<Record<string, string | number>>
  readonly signal?: AbortSignal
}

interface SendInit {
  readonly body?: unknown
  readonly signal?: AbortSignal
}

interface ApiRequest extends GetInit, SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
}

/** A failed `/v1` call, page-side: `web` cannot import `core/errors`. `code` is the daemon's
 *  `ApiErrorCode`, or what the page saw itself; `message` is the daemon's sentence, else empty. */
export class ApiFailure extends Error {
  readonly status: number
  readonly code: FailureCode

  constructor(status: number, code: FailureCode, message = '') {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

/** Throws `ApiFailure` for every failure except the caller's own abort, which it rethrows. */
export function getJson<T>(def: RouteDef<T>, init: GetInit = {}): Promise<T> {
  return request(def, { ...init, method: 'GET' })
}

/** As `getJson`, for a write: `body` goes as JSON. */
export function sendJson<T>(
  method: 'POST' | 'PATCH' | 'DELETE',
  def: RouteDef<T>,
  init: SendInit = {}
): Promise<T> {
  return request(def, { ...init, method })
}

async function request<T>(def: RouteDef<T>, init: ApiRequest): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = init.signal === undefined ? timeout : AbortSignal.any([init.signal, timeout])
  const token = readToken()

  try {
    const response = await fetch(buildUrl(def.path, init.query), {
      method: init.method,
      headers: buildHeaders(token, init.body !== undefined),
      body: init.body === undefined ? null : JSON.stringify(init.body),
      signal,
    })

    if (!response.ok) {
      throw await toApiFailure(response, token)
    }

    return await readJson<T>(response)
  } catch (error: unknown) {
    if (error instanceof ApiFailure || init.signal?.aborted === true) {
      throw error
    }

    throw new ApiFailure(NO_STATUS, timeout.aborted ? 'timeout' : 'unreachable')
  }
}

function buildUrl(path: string, query: GetInit['query']): string {
  if (query === undefined) {
    return path
  }

  const params = new URLSearchParams(
    Object.entries(query).map(([name, value]) => [name, String(value)])
  )

  return `${path}?${params}`
}

function buildHeaders(token: string | undefined, hasBody: boolean): Record<string, string> {
  return {
    ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    ...(hasBody ? { 'Content-Type': JSON_CONTENT_TYPE } : {}),
  }
}

// A refusal of a token the operator has since replaced says nothing about the new one.
async function toApiFailure(
  response: Response,
  sentToken: string | undefined
): Promise<ApiFailure> {
  if (response.status === UNAUTHORIZED_STATUS && sentToken === readToken()) {
    clearToken()
    authState.value = 'refused'
  }

  const body: unknown = await response.json().catch(() => undefined)

  if (!isErrorBody(body)) {
    return new ApiFailure(response.status, 'bad_response')
  }

  const code = isApiErrorCode(body.error.code) ? body.error.code : 'generic'

  return new ApiFailure(response.status, code, body.error.message ?? '')
}

function isApiErrorCode(code: string): code is ApiErrorCode {
  return Object.hasOwn(API_ERROR_CODES, code)
}

function isErrorBody(
  body: unknown
): body is { readonly error: { readonly code: string; readonly message?: string } } {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false
  }

  const { error } = body

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    (!('message' in error) || typeof error.message === 'string')
  )
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    // why-safe: the route's wire type is the daemon's contract for this path.
    return (await response.json()) as T
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new ApiFailure(response.status, 'bad_response')
    }

    throw error
  }
}

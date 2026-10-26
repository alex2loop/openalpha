import type { ApiErrorCode, ApiFieldError, UnconfirmedPriceWire } from '@/app/server/wire/errors'
import type { RouteDef } from '@/web/api/routes'
import { noteRefused } from '@/web/api/sign-in'

const REQUEST_TIMEOUT_MS = 20_000
/** The status of a request the daemon refused for want of a signed-in session. */
export const UNAUTHORIZED_STATUS = 401
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
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

interface ApiRequest extends GetInit, SendInit {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
}

/** What the daemon added to a refusal: its sentence, the fields it refused, the typed price it
 *  doubted. */
interface FailureDetail {
  readonly message?: string
  readonly fields?: readonly ApiFieldError[]
  readonly unconfirmedPrice?: UnconfirmedPriceWire
}

/** A failed `/v1` call, page-side: `web` cannot import `core/errors`. `code` is the daemon's
 *  `ApiErrorCode`, or what the page saw itself; `message` is the daemon's sentence, else empty.
 *  `fields` names each refused field of a body; `unconfirmedPrice` is on `price_unconfirmed`. */
export class ApiFailure extends Error {
  readonly status: number
  readonly code: FailureCode
  readonly fields: readonly ApiFieldError[]
  readonly unconfirmedPrice?: UnconfirmedPriceWire

  constructor(status: number, code: FailureCode, detail: FailureDetail = {}) {
    super(detail.message ?? '')
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
    this.fields = detail.fields ?? []

    if (detail.unconfirmedPrice !== undefined) {
      this.unconfirmedPrice = detail.unconfirmedPrice
    }
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

  try {
    const response = await fetch(buildUrl(def.path, init.query), {
      method: init.method,
      credentials: 'same-origin',
      headers: buildHeaders(init),
      body: init.body === undefined ? null : JSON.stringify(init.body),
      signal,
    })

    if (!response.ok) {
      throw await toApiFailure(response)
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

function buildHeaders(init: ApiRequest): Record<string, string> {
  return {
    ...init.headers,
    ...(init.body === undefined ? {} : { 'Content-Type': JSON_CONTENT_TYPE }),
  }
}

async function toApiFailure(response: Response): Promise<ApiFailure> {
  if (response.status === UNAUTHORIZED_STATUS) {
    noteRefused()
  }

  const body: unknown = await response.json().catch(() => undefined)

  if (!isErrorBody(body)) {
    return new ApiFailure(response.status, 'bad_response')
  }

  const { message, fields, unconfirmedPrice } = body.error
  const code = isApiErrorCode(body.error.code) ? body.error.code : 'generic'

  return new ApiFailure(response.status, code, {
    ...(message === undefined ? {} : { message }),
    ...(fields === undefined ? {} : { fields }),
    ...(unconfirmedPrice === undefined ? {} : { unconfirmedPrice }),
  })
}

function isApiErrorCode(code: string): code is ApiErrorCode {
  return Object.hasOwn(API_ERROR_CODES, code)
}

interface ErrorBody {
  readonly error: {
    readonly code: string
    readonly message?: string
    readonly fields?: readonly ApiFieldError[]
    readonly unconfirmedPrice?: UnconfirmedPriceWire
  }
}

function isErrorBody(body: unknown): body is ErrorBody {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return false
  }

  const { error } = body

  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    (!('message' in error) || typeof error.message === 'string') &&
    (!('fields' in error) || isFieldList(error.fields))
  )
}

function isFieldList(value: unknown): value is readonly ApiFieldError[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item: unknown) =>
        typeof item === 'object' &&
        item !== null &&
        'path' in item &&
        typeof item.path === 'string' &&
        'message' in item &&
        typeof item.message === 'string'
    )
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

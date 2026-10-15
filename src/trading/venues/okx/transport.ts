import type { Logger } from '@/core/logging/logger'
import type { OkxCredentials } from '@/trading/venues/okx/sign'
import type { VenueRequest, VenueTransport } from '@/trading/venues/transport'
import { OrderError } from '@/trading/features/order/types'
import { signOkxRequest } from '@/trading/venues/okx/sign'
import { createVenueTransport, retriedRead, unretried } from '@/trading/venues/transport'

const OKX_HOSTS: readonly string[] = Object.freeze(['https://www.okx.com'])
const transport: VenueTransport = createVenueTransport(OKX_HOSTS)
// A parameter or credential error arrives as a 4xx carrying the same `{ code, msg }` envelope as a
// 200; every other non-2xx stays a failed attempt.
const ERROR_BODY_STATUSES: readonly number[] = Object.freeze([400, 401])
const OK_CODE = '0'
const AUTH_ERROR_CODES: ReadonlySet<string> = new Set([
  '50100',
  '50101',
  '50102',
  '50103',
  '50104',
  '50111',
  '50112',
  '50113',
  '50114',
])
const INSUFFICIENT_ERROR_CODES: ReadonlySet<string> = new Set(['51008', '51131'])
// The venue's rate limit. Like a 429 it arrives as an answer, and replaying it inside the retry
// window only deepens it, so it is never transient.
const RATE_LIMIT_ERROR_CODE = '50011'
// Transient by the venue's own classification: its two "busy, try again" codes. They arrive in a
// 200 body, so nothing below the envelope can see them.
const TRANSIENT_ERROR_CODES: ReadonlySet<string> = new Set(['50013', '50026'])
// The order endpoints answer a refused order with a top-level "1" (all failed) or "2" (some
// failed), and the real reason sits on the row.
const ROW_FAILURE_ENVELOPE_CODES: ReadonlySet<string> = new Set(['1', '2'])
// "Order does not exist". The one code a lookup may read as absent: a rate limit or an expired key
// during a lookup is a failure, and a failure that read as "gone" would close an exit still live.
export const NOT_FOUND_CODES: ReadonlySet<string> = new Set(['51603'])
export const INSTRUMENTS_PATH = '/api/v5/public/instruments'
export const SPOT_INST_TYPE = 'SPOT'
/** The one currency this venue settles pairs in, so a base asset is addressed and sized
 *  against exactly one instrument. */
export const OKX_QUOTE_ASSET = 'USDT'
// OKX takes a case-sensitive alphanumeric `clOrdId` of at most 32 characters.
export const CLIENT_ORDER_ID_LENGTH = 32
// A cancel that lost the race to a fill or an earlier cancel has nothing left to do; the order
// read back afterwards says which.
export const CANCEL_SETTLED_CODES: ReadonlySet<string> = new Set([
  '51400',
  '51401',
  '51402',
  '51603',
])

/** Almost every page is a list of flat string cells; `account/balance` nests a second list, which
 *  is why the row shape is the caller's to name. */
interface OkxEnvelope<TRow> {
  readonly code: string
  readonly msg: string
  readonly data?: readonly TRow[]
}

export type OkxRow = Record<string, string>

/** The code and message that decide a response's fate: the envelope's own, or the first failed
 *  row's `sCode` / `sMsg`. */
interface OkxFailure {
  readonly code: string
  readonly msg: string
}

export interface OkxTransportDeps {
  readonly credentials: OkxCredentials
  readonly logger: Logger
  now(): number
}

interface PrivateRequest {
  readonly method: 'GET' | 'POST'
  readonly path: string
  readonly query?: Record<string, string>
  readonly body?: unknown
  readonly signal: AbortSignal
  /** Codes that answer the request rather than fail it, returned as no rows. */
  readonly acceptedCodes?: ReadonlySet<string>
}

export function privateRequest<TRow = OkxRow>(
  deps: OkxTransportDeps,
  request: PrivateRequest
): Promise<readonly TRow[]> {
  if (request.method === 'GET') {
    return retriedRead(request.signal, (budget) => signedRequest<TRow>(deps, request, budget))
  }

  return unretried(request.signal, (budget) => signedRequest<TRow>(deps, request, budget))
}

async function signedRequest<TRow>(
  deps: OkxTransportDeps,
  request: PrivateRequest,
  budget: AbortSignal
): Promise<readonly TRow[]> {
  const search = new URLSearchParams(request.query ?? {}).toString()
  const requestPath = search === '' ? request.path : `${request.path}?${search}`
  // Signed and sent as one string: re-serializing produces a body the signature does not cover.
  const body = request.body === undefined ? '' : JSON.stringify(request.body)
  const headers = signOkxRequest({
    credentials: deps.credentials,
    method: request.method,
    requestPath,
    body,
    now: deps.now(),
  })
  const outbound: VenueRequest = {
    path: request.path,
    method: request.method,
    headers,
    signal: budget,
    errorBodyStatuses: ERROR_BODY_STATUSES,
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.body === undefined ? {} : { body }),
  }
  const response = await transport.send(outbound)

  return toRows<TRow>(response, request.acceptedCodes)
}

export function publicRequest<TRow = OkxRow>(
  path: string,
  query: Record<string, string>,
  signal: AbortSignal
): Promise<readonly TRow[]> {
  return retriedRead(signal, async (budget) =>
    toRows<TRow>(
      await transport.send({
        path,
        method: 'GET',
        headers: {},
        query,
        signal: budget,
        errorBodyStatuses: ERROR_BODY_STATUSES,
      })
    )
  )
}

function toRows<TRow>(text: string, acceptedCodes?: ReadonlySet<string>): readonly TRow[] {
  const envelope = parseEnvelope<TRow>(text)
  const failure = toFailure(envelope)

  if (failure === undefined) {
    return envelope.data ?? []
  }

  if (acceptedCodes?.has(failure.code) === true) {
    return []
  }

  throw toFailureError(failure)
}

function toFailure<TRow>(envelope: OkxEnvelope<TRow>): OkxFailure | undefined {
  if (envelope.code === OK_CODE || ROW_FAILURE_ENVELOPE_CODES.has(envelope.code)) {
    for (const row of envelope.data ?? []) {
      const failure = toRowFailure(row)

      if (failure !== undefined) {
        return failure
      }
    }
  }

  return envelope.code === OK_CODE ? undefined : { code: envelope.code, msg: envelope.msg }
}

function toRowFailure(row: unknown): OkxFailure | undefined {
  if (typeof row !== 'object' || row === null || !('sCode' in row)) {
    return undefined
  }

  const { sCode } = row

  if (typeof sCode !== 'string' || sCode === '' || sCode === OK_CODE) {
    return undefined
  }

  return { code: sCode, msg: 'sMsg' in row && typeof row.sMsg === 'string' ? row.sMsg : '' }
}

function toFailureError(failure: OkxFailure): OrderError {
  if (failure.code === RATE_LIMIT_ERROR_CODE) {
    return new OrderError('order.rate_limited', `the venue is rate limiting (${failure.code})`)
  }

  if (TRANSIENT_ERROR_CODES.has(failure.code)) {
    return new OrderError('order.network', `the venue is busy (${failure.code})`)
  }

  if (AUTH_ERROR_CODES.has(failure.code)) {
    return new OrderError('order.auth', `the credentials were rejected (${failure.code})`)
  }

  if (INSUFFICIENT_ERROR_CODES.has(failure.code)) {
    return new OrderError('order.insufficient', `insufficient balance (${failure.code})`)
  }

  return new OrderError('order.rejected', `${failure.code}: ${failure.msg}`)
}

function parseEnvelope<TRow>(text: string): OkxEnvelope<TRow> {
  let parsed: unknown

  try {
    parsed = JSON.parse(text)
  } catch (err: unknown) {
    throw new OrderError('order.network', 'the response is not JSON', err)
  }

  if (typeof parsed !== 'object' || parsed === null || !('code' in parsed)) {
    throw new OrderError('order.network', 'the response is not an envelope')
  }

  // why-safe: narrowed to an object carrying `code`, and every field below is read defensively —
  // a missing `data` becomes an empty page and every cell is parsed, never trusted.
  return parsed as OkxEnvelope<TRow>
}

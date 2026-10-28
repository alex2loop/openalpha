import type { InstrumentRefWire } from '@/app/server/wire/trading'

// The /v1 error contract. Every non-2xx JSON response is `{ error: { code } }` — a stable,
// machine-readable code, never a leaked internal message. Clients switch on `error.code`, not on a
// brittle status+string. One source of truth for "which code → which HTTP status".

/** The codes actually emitted (no dead codes). Each maps to a call site: forbidden=loopback guard,
 *  unauthorized=auth guard, not_found=dispatch miss, too_many_streams=/v1/ws socket cap,
 *  stopping=a read the daemon dropped because it is stopping or restarting;
 *  the rest are body/symbol/upstream validation. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'invalid_body'
  | 'conflict'
  | 'price_unconfirmed'
  | 'upstream_failed'
  | 'too_many_streams'
  | 'unavailable'
  | 'stopping'
  | 'timeout'
  | 'internal'

/** What a `price_unconfirmed` refusal held: the typed price and the market's own price it was
 *  measured against, for a client to word in its own format before asking. */
export interface UnconfirmedPriceWire {
  readonly instrument: InstrumentRefWire
  readonly price: number
  /** `at` is the day that price stands for, `YYYY-MM-DD`. */
  readonly latest: { readonly price: number; readonly at: string }
}

/** One refused field of a request: where it sits in the body the caller sent (`quantity`,
 *  `instrument.ticker`; empty for the body as a whole) and the sentence for it. */
export interface ApiFieldError {
  readonly path: string
  readonly message: string
}

/** The JSON body of any non-2xx response. */
export interface ApiError {
  /** `message` is the runtime's own sentence for a refusal it explains to the operator (a ledger
   *  row the book cannot hold, say), in the daemon's language. Absent on every other error.
   *  `unconfirmedPrice` is set on `price_unconfirmed` alone. `fields` names each field a body was
   *  refused for, in the daemon's language, where the refusal is about fields (a ledger draft);
   *  `message` then carries the first. */
  readonly error: {
    readonly code: ApiErrorCode
    readonly message?: string
    readonly unconfirmedPrice?: UnconfirmedPriceWire
    readonly fields?: readonly ApiFieldError[]
  }
}

/** Canonical code → HTTP status. The response helper reads this; a client MAY use it to map a status
 *  back to a code when the body is unavailable (e.g. a transport-level failure). */
export const API_ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_body: 400,
  conflict: 409,
  price_unconfirmed: 422,
  upstream_failed: 502,
  too_many_streams: 503,
  unavailable: 503,
  stopping: 503,
  timeout: 504,
  internal: 500,
}

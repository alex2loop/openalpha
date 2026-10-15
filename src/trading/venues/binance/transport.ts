import { z } from 'zod'

import type { Logger } from '@/core/logging/logger'
import type { BinanceCredentials } from '@/trading/venues/binance/sign'
import type { VenueRequest, VenueTransport } from '@/trading/venues/transport'
import { OrderError } from '@/trading/features/order/types'
import { signBinanceQuery } from '@/trading/venues/binance/sign'
import { createVenueTransport, retriedRead, unretried } from '@/trading/venues/transport'

const LIVE_HOST = 'https://api.binance.com'
const DEMO_HOST = 'https://demo-api.binance.com'
// One host per mode, never a failover list: Binance frees a client order id once its order fills,
// so a write re-sent to a second host after a timeout could fill twice.
const LIVE_TRANSPORT: VenueTransport = createVenueTransport([LIVE_HOST])
const DEMO_TRANSPORT: VenueTransport = createVenueTransport([DEMO_HOST])
// A refusal arrives as a 4xx carrying `{ code, msg }`; every other non-2xx stays a failed attempt.
const ERROR_BODY_STATUSES: readonly number[] = Object.freeze([400, 401])
const CLOCK_ERROR_CODES: ReadonlySet<number> = new Set([-1021])
// `-2008` is an API key id Binance does not know: a mistyped key, or a demo key sent to the live host.
const AUTH_ERROR_CODES: ReadonlySet<number> = new Set([-1022, -2008, -2014, -2015])
// Binance's own "execution status unknown": the write may have landed, so it reads as a failed
// request and the caller reads the order back by its client id.
const UNKNOWN_OUTCOME_CODES: ReadonlySet<number> = new Set([-1000, -1006, -1007])
const ORDER_REJECTED_CODE = -2010
// `-2010` covers every matching-engine refusal; only its message names the balance one.
const INSUFFICIENT_BALANCE_TEXT = 'insufficient balance'
const REFUSAL = z.object({ code: z.number(), msg: z.string() })

export const BINANCE_QUOTE_ASSET = 'USDT'
export const BINANCE_CLIENT_ORDER_ID_LENGTH = 36
export const ORDER_NOT_FOUND_CODES: ReadonlySet<number> = new Set([-2013])
// "Unknown order sent": the order already filled or was already cancelled.
export const BINANCE_CANCEL_SETTLED_CODES: ReadonlySet<number> = new Set([-2011])
export const UNKNOWN_SYMBOL_CODES: ReadonlySet<number> = new Set([-1121])
/** Binance writes every amount as a decimal string. */
export const DECIMAL = z.string().transform(Number).pipe(z.number())
/** For a write whose answer nothing reads. */
export const UNREAD_BODY = z.unknown()

export interface BinanceTransportDeps {
  readonly credentials: BinanceCredentials
  readonly logger: Logger
  now(): number
}

interface BinanceRequest<T> {
  readonly path: string
  readonly params?: Readonly<Record<string, string>>
  readonly schema: z.ZodType<T>
  readonly signal: AbortSignal
  /** Codes that answer the request rather than fail it, returned as undefined. */
  readonly acceptedCodes?: ReadonlySet<number>
  readonly maxBytes?: number
}

interface SignedRequest<T> extends BinanceRequest<T> {
  readonly method: VenueRequest['method']
}

export function signedRequest<T>(
  deps: BinanceTransportDeps,
  request: SignedRequest<T>
): Promise<T | undefined> {
  if (request.method === 'GET') {
    return retriedRead(request.signal, (budget) => sendSigned(deps, request, budget))
  }

  return unretried(request.signal, (budget) => sendSigned(deps, request, budget))
}

export function binancePublicRequest<T>(
  simulated: boolean,
  request: BinanceRequest<T>
): Promise<T | undefined> {
  return retriedRead(request.signal, async (budget) => {
    const text = await transportFor(simulated).send({
      path: request.path,
      method: 'GET',
      headers: {},
      query: { ...request.params },
      errorBodyStatuses: ERROR_BODY_STATUSES,
      signal: budget,
      ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
    })

    return parseAnswer(text, request)
  })
}

function transportFor(simulated: boolean): VenueTransport {
  return simulated ? DEMO_TRANSPORT : LIVE_TRANSPORT
}

// Signed per attempt, so a retried read carries a fresh timestamp rather than one the receive
// window has already passed.
async function sendSigned<T>(
  deps: BinanceTransportDeps,
  request: SignedRequest<T>,
  budget: AbortSignal
): Promise<T | undefined> {
  const signed = signBinanceQuery({
    credentials: deps.credentials,
    params: request.params ?? {},
    now: deps.now(),
  })
  const text = await transportFor(deps.credentials.simulated).send({
    path: request.path,
    method: request.method,
    headers: signed.headers,
    query: signed.query,
    errorBodyStatuses: ERROR_BODY_STATUSES,
    signal: budget,
    ...(request.maxBytes === undefined ? {} : { maxBytes: request.maxBytes }),
  })

  return parseAnswer(text, request)
}

function parseAnswer<T>(text: string, request: BinanceRequest<T>): T | undefined {
  const body = parseJson(text)
  const refusal = REFUSAL.safeParse(body)

  if (refusal.success) {
    if (request.acceptedCodes?.has(refusal.data.code) === true) {
      return undefined
    }

    throw toOrderError(refusal.data.code, refusal.data.msg)
  }

  const parsed = request.schema.safeParse(body)

  if (!parsed.success) {
    throw new OrderError('order.network', `binance answered ${request.path} in an unreadable shape`)
  }

  return parsed.data
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (err: unknown) {
    throw new OrderError('order.network', 'the binance response is not json', err)
  }
}

function toOrderError(code: number, msg: string): OrderError {
  const detail = `binance ${code}: ${msg}`

  if (CLOCK_ERROR_CODES.has(code)) {
    return new OrderError('order.clock_skew', detail)
  }

  if (AUTH_ERROR_CODES.has(code)) {
    return new OrderError('order.auth', detail)
  }

  if (UNKNOWN_OUTCOME_CODES.has(code)) {
    return new OrderError('order.network', detail)
  }

  if (code === ORDER_REJECTED_CODE && msg.toLowerCase().includes(INSUFFICIENT_BALANCE_TEXT)) {
    return new OrderError('order.insufficient', detail)
  }

  return new OrderError('order.rejected', detail)
}

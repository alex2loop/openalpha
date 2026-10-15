import type { ExitLevels, OrderRequest, OrderSide, OrderType } from '@/trading/features/order/types'
import type { Ticker, VenueRef, VenueTickerRequest } from '@/trading/kernel/instrument'
import { exitLevelsOf } from '@/trading/features/order/types'
import {
  parseFiniteNumber,
  parseMember,
  parseVenueTickerRequest,
} from '@/trading/kernel/surface/surface'
import { ORDER_SIDES } from '@/trading/kernel/venue/spot-adapter'

const SPOT_ACTION = 'spot'
const EXIT_ACTION = 'exit'
const CONFIRM_ACTION = 'confirm'
const CANCEL_ACTION = 'cancel'
const RECONCILE_ACTION = 'reconcile'
const HALT_ACTION = 'halt'
const RESUME_ACTION = 'resume'
export const TRADE_ACTIONS = Object.freeze([
  SPOT_ACTION,
  EXIT_ACTION,
  CONFIRM_ACTION,
  CANCEL_ACTION,
  RECONCILE_ACTION,
  HALT_ACTION,
  RESUME_ACTION,
] as const)
const LIMIT_LABEL = 'limit'
const QUANTITY_LABEL = 'qty'
const TAKE_PROFIT_LABEL = 'tp'
const STOP_LOSS_LABEL = 'sl'
const CANCEL_ARGUMENTS = 1
const CONFIRM_ARGUMENTS_WITH_TOKEN = 1
const RECONCILE_ARGUMENTS_WITH_TOKEN = 1
/** `<[venue:]ticker> <buy|sell> <quantity>`, before any labelled pair. */
const STAGE_ARGUMENTS = 3
/** `<[venue:]ticker> <label> <price>`: the shortest line that names an instrument and one level. */
const EXIT_ARGUMENTS = 3
const EXIT_LEADING = 1
const LABELLED_PAIR = 2

export type TradeCommand =
  /** A bare `/trade`: what is outstanding, which is also how the operator finds a token again. */
  | { readonly kind: 'status' }
  | { readonly kind: 'stage'; readonly request: OrderRequest }
  /** Bare where exactly one order is waiting, which is the usual case; the token names one of
   *  several, the same way a venue names one of several that could fill an order. */
  | { readonly kind: 'confirm'; readonly token?: string }
  | { readonly kind: 'cancel'; readonly ticker: Ticker; readonly venue?: VenueRef }
  | {
      readonly kind: 'exit'
      readonly ticker: Ticker
      readonly exit: ExitLevels
      /** How much of the position to guard. Absent covers all of it. */
      readonly quantity?: number
      readonly venue?: VenueRef
    }
  /** A bare `reconcile` lists what is outstanding; a token settles that one row. */
  | { readonly kind: 'reconcile'; readonly token?: string }
  /** Bare only: switching buying off or on takes no argument an operator could get wrong. */
  | { readonly kind: 'halt' }
  | { readonly kind: 'resume' }

interface Tail {
  readonly limitPrice?: number
  readonly quantity?: number
  readonly takeProfit?: number
  readonly stopLoss?: number
}

/** Positional up to the quantity, then labelled pairs: a fourth and fifth bare number in a row is a
 *  line no operator can read back to themselves. The instrument is one token, `[venue:]ticker`, so
 *  nothing here is read off the argument count. The ticker is the base asset alone — a `Ticker`
 *  admits no slash, and the pair symbol belongs to the adapter. */
export function parseTradeArgs(args: readonly string[]): TradeCommand | null {
  const [action, ...rest] = args

  if (action === undefined) {
    return { kind: 'status' }
  }

  if (action === HALT_ACTION || action === RESUME_ACTION) {
    return rest.length === 0 ? { kind: action } : null
  }

  if (action === CONFIRM_ACTION) {
    return parseConfirm(rest)
  }

  if (action === CANCEL_ACTION) {
    return parseCancel(rest)
  }

  if (action === RECONCILE_ACTION) {
    return parseReconcile(rest)
  }

  if (action === EXIT_ACTION) {
    return parseExit(rest)
  }

  return action === SPOT_ACTION ? parseStage(rest) : null
}

/** Bare, or naming the one order among several. A second argument is a line the operator meant
 *  differently from how it would be read, so it is refused rather than narrowed to the first. */
function parseConfirm(rest: readonly string[]): TradeCommand | null {
  if (rest.length > CONFIRM_ARGUMENTS_WITH_TOKEN) {
    return null
  }

  const [token] = rest

  return { kind: 'confirm', ...(token === undefined ? {} : { token }) }
}

/** Whether this line confirms an order at all, read without parsing the rest: the dispatcher picks
 *  the invocation policy before the command ever runs, and a bare confirm is still a confirm. */
export function isConfirmArgs(args: readonly string[]): boolean {
  return parseTradeArgs(args)?.kind === 'confirm'
}

/** The token a confirm carries, or `undefined` where it names none. */
export function confirmTokenOf(args: readonly string[]): string | undefined {
  const parsed = parseTradeArgs(args)

  return parsed?.kind === 'confirm' ? parsed.token : undefined
}

/** `[venue:]ticker`: the venue is only ever named to separate two resting exits on one instrument. */
function parseCancel(rest: readonly string[]): TradeCommand | null {
  if (rest.length !== CANCEL_ARGUMENTS) {
    return null
  }

  const request = parseVenueTickerRequest(rest[0])

  return request === null ? null : { kind: 'cancel', ...request }
}

/** `[venue:]ticker` then labelled pairs. `limit` is not one of the labels a resting exit accepts —
 *  an exit is a trigger, not a price to rest at. */
function parseExit(rest: readonly string[]): TradeCommand | null {
  if (rest.length < EXIT_ARGUMENTS) {
    return null
  }

  const request = parseVenueTickerRequest(rest[0])
  const tail = parseTail(rest.slice(EXIT_LEADING))

  if (request === null || tail === null || tail.limitPrice !== undefined) {
    return null
  }

  const exit = exitLevelsOf(tail)

  if (exit === undefined) {
    return null
  }

  return {
    kind: 'exit',
    ...request,
    exit,
    ...(tail.quantity === undefined ? {} : { quantity: tail.quantity }),
  }
}

/** Bare, or with the one token whose row the operator has just settled in the book. */
function parseReconcile(rest: readonly string[]): TradeCommand | null {
  if (rest.length > RECONCILE_ARGUMENTS_WITH_TOKEN) {
    return null
  }

  const [token] = rest

  return { kind: 'reconcile', ...(token === undefined ? {} : { token }) }
}

function parseStage(rest: readonly string[]): TradeCommand | null {
  if (rest.length < STAGE_ARGUMENTS) {
    return null
  }

  const [rawInstrument, rawSide, rawQuantity] = rest
  const request = parseVenueTickerRequest(rawInstrument)
  const side = parseMember(rawSide, ORDER_SIDES)
  const quantity = parseFiniteNumber(rawQuantity)
  const tail = parseTail(rest.slice(STAGE_ARGUMENTS))

  if (request === null || side === null || tail === null) {
    return null
  }

  // The quantity is positional on a staged order, so a second one in the tail is two answers to
  // one question rather than a size this may pick between.
  if (tail.quantity !== undefined) {
    return null
  }

  if (quantity === null || quantity <= 0) {
    return null
  }

  return toStage({ ...request, side, quantity }, tail)
}

interface StageParts extends VenueTickerRequest {
  readonly side: OrderSide
  readonly quantity: number
}

/** `market` is the default: the order type is whether a `limit <price>` pair was given, so the type
 *  and the price it needs can never be stated apart. */
function toStage(parts: StageParts, tail: Tail): TradeCommand | null {
  const orderType: OrderType = tail.limitPrice === undefined ? 'market' : 'limit'
  const exit = exitLevelsOf(tail)

  // An exit rides a buy: a sell is the way out already, so a stop or target on one is a usage error,
  // not a request the write path may quietly drop.
  if (parts.side === 'sell' && exit !== undefined) {
    return null
  }

  return {
    kind: 'stage',
    request: {
      ticker: parts.ticker,
      side: parts.side,
      ...(parts.venue === undefined ? {} : { venue: parts.venue }),
      orderType,
      quantity: parts.quantity,
      ...(tail.limitPrice === undefined ? {} : { limitPrice: tail.limitPrice }),
      ...(exit === undefined ? {} : { exit }),
    },
  }
}

function parseTail(rest: readonly string[]): Tail | null {
  if (rest.length % LABELLED_PAIR !== 0) {
    return null
  }

  let tail: Tail = {}

  for (let index = 0; index < rest.length; index += LABELLED_PAIR) {
    const value = parseFiniteNumber(rest[index + 1])
    const label = rest[index]

    if (value === null || value <= 0) {
      return null
    }

    if (label === LIMIT_LABEL) {
      tail = { ...tail, limitPrice: value }
    } else if (label === QUANTITY_LABEL) {
      tail = { ...tail, quantity: value }
    } else if (label === TAKE_PROFIT_LABEL) {
      tail = { ...tail, takeProfit: value }
    } else if (label === STOP_LOSS_LABEL) {
      tail = { ...tail, stopLoss: value }
    } else {
      return null
    }
  }

  return tail
}

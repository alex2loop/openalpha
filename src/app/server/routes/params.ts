import type { ApiRouteContext } from '@/app/types'
import type { Locale } from '@/core/types/locale'
import type { InstrumentRef, TradingHost } from '@/trading/api'
import { marketRef, ticker } from '@/trading/api'

/** Long enough for a UUID with a prefix; a key past it is a client bug, not a retry. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200

/** The single resolution point. Nine handlers reaching into the container separately would be nine
 *  places to change if the key ever moved. */
export function hostOf(ctx: ApiRouteContext): TradingHost {
  return ctx.app.resolve('tradingHost')
}

/** The operator's language, which every CLI sentence on the wire is written in. */
export function localeOf(ctx: ApiRouteContext): Locale {
  return ctx.app.config.locale.language
}

/** Three outcomes, deliberately distinct: `undefined` = the caller omitted it (the host applies its
 *  default), `null` = the caller sent something the brand rejects (400), a value = it parsed. A
 *  two-state result would make "absent" and "malformed" the same answer. */
export function parseOptionalBranded<T>(
  raw: string | null,
  brand: (value: string) => T
): T | null | undefined {
  if (raw === null) {
    return undefined
  }

  try {
    return brand(raw)
  } catch {
    return null
  }
}

/** A path segment as a branded id, counted back from the end (`fromEnd` 1 reads the id in
 *  `/v1/suggestions/:id/card`). `null` when the brand rejects it or it is not valid
 *  percent-encoding: either is the caller's mistake, a 400. */
export function parsePathId<T>(req: Request, brand: (value: string) => T, fromEnd = 0): T | null {
  const segments = new URL(req.url).pathname.split('/')
  const segment = segments[segments.length - 1 - fromEnd]

  if (segment === undefined) {
    return null
  }

  try {
    return brand(decodeURIComponent(segment))
  } catch {
    return null
  }
}

/** An omitted `limit` means "this surface's maximum". A malformed one is a 400 rather than a
 *  silent clamp — a client asking for 500 rows should learn that it cannot have them. */
export function parseLimit(raw: string | null, maximum: number): number | null {
  if (raw === null) {
    return maximum
  }

  const value = Number(raw)

  return Number.isInteger(value) && value > 0 && value <= maximum ? value : null
}

/** A required value from a closed set; `null` when it is absent or outside the set (400). */
export function parseOneOf<T extends string>(raw: string | null, allowed: readonly T[]): T | null {
  return allowed.find((value) => value === raw) ?? null
}

/** `market` and `ticker` together; `null` when either is missing or malformed (400). */
export function parseInstrument(query: URLSearchParams): InstrumentRef | null {
  const rawMarket = query.get('market')
  const rawTicker = query.get('ticker')

  if (rawMarket === null || rawTicker === null) {
    return null
  }

  try {
    return { market: marketRef(rawMarket), ticker: ticker(rawTicker) }
  } catch {
    return null
  }
}

/** One name's rows when the caller names one: `undefined` when neither is sent, `null` for a
 *  half-named or malformed one (400). */
export function parseOptionalInstrument(query: URLSearchParams): InstrumentRef | null | undefined {
  const named = query.has('market') || query.has('ticker')

  return named ? parseInstrument(query) : undefined
}

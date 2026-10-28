import type { ApiRouteContext } from '@/app/types'
import type { FieldLabel } from '@/core/field-errors'
import type { Locale } from '@/core/types/locale'
import type { InstrumentRef, TradingDay, TradingHost } from '@/trading/api'
import { ValidationError } from '@/core/errors'
import { FieldValidationError } from '@/core/field-errors'
import { dayInZone, dayRangeInZone } from '@/core/utils/time'
import { marketRef, ticker, tradingDay } from '@/trading/api'

/** Long enough for a UUID with a prefix; a key past it is a client bug, not a retry. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200
const DIGITS_RE = /^\d+$/
// Whatever id a row carries (a UUID, a chat id), as the last row of a page names it.
const CURSOR_ID_RE = /^[\w-]{1,64}$/
const WHOLE_BODY_LABEL = 'body'
const BYTES_PER_KB = 1024
const DEFAULT_MAX_BODY_BYTES = 64 * BYTES_PER_KB

/** The single resolution point. Nine handlers reaching into the container separately would be nine
 *  places to change if the key ever moved. */
export function hostOf(ctx: ApiRouteContext): TradingHost {
  return ctx.app.resolve('tradingHost')
}

/** The operator's language, which every CLI sentence on the wire is written in. */
export function localeOf(ctx: ApiRouteContext): Locale {
  return ctx.app.config.locale.language
}

/** The request's JSON body, read once and capped. `undefined` = no body was sent, `null` = it is not
 *  JSON; both fail any schema, so a route that needs a body answers `invalid_body` for either (a
 *  route where no body means "everything" tells them apart). A body over `maxBytes` is refused
 *  with the keyed sentence, so the page reads it in the operator's language. */
export async function readJsonBody(
  req: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): Promise<unknown> {
  const text = await readCappedText(req, maxBytes)

  if (text === '') {
    return undefined
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Stops reading at `maxBytes`, so an unauthenticated route never takes in more than its cap. */
async function readCappedText(req: Request, maxBytes: number): Promise<string> {
  if (req.body === null) {
    return ''
  }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  try {
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength

      if (size > maxBytes) {
        await reader.cancel()

        throw new ValidationError(`request body is over ${maxBytes} bytes`, {
          key: 'errors.bodyTooLarge',
          params: { limit: Math.floor(maxBytes / BYTES_PER_KB) },
        })
      }

      chunks.push(read.value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks).toString('utf8')
}

/** A body field's name as the operator reads it, keyed by where it sits in the body; a path the
 *  catalog does not know prints as written. */
export function toBodyFieldLabel(path: string): FieldLabel {
  const name = path === '' ? WHOLE_BODY_LABEL : path

  return { key: `errors.fieldLabel.${name}`, fallback: name }
}

/** A refusal of one body field, for a check only the route can make (`kind` is a key under
 *  `errors.fields`). */
export function fieldRefusal(path: string, kind: string): FieldValidationError {
  return fieldsRefusal([path], kind)
}

/** As `fieldRefusal`, for every field one check refused. */
export function fieldsRefusal(paths: readonly string[], kind: string): FieldValidationError {
  return new FieldValidationError(
    `invalid ${paths.join(', ')}: ${kind}`,
    paths.map((path) => ({
      path,
      message: { key: `errors.fields.${kind}`, params: { field: toBodyFieldLabel(path) } },
    }))
  )
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

/** One `?day` for every route that reads a day: the operator's day in `zone` (today when omitted)
 *  and the instants it spans; `null` when it is malformed or names no day (400). */
export function parseDayQuery(
  query: URLSearchParams,
  zone: string
): {
  readonly day: TradingDay
  readonly range: { readonly fromMs: number; readonly toMs: number }
} | null {
  const requested = parseOptionalBranded(query.get('day'), tradingDay)

  if (requested === null) {
    return null
  }

  const day = requested ?? tradingDay(dayInZone(Date.now(), zone))
  const range = dayRangeInZone({ fromDay: day, toDay: day }, zone)

  return range === undefined ? null : { day, range }
}

/** An omitted `limit` means "this surface's maximum". A malformed one is a 400 rather than a
 *  silent clamp — a client asking for 500 rows should learn that it cannot have them. */
export function parseLimit(raw: string | null, maximum: number): number | null {
  if (raw === null) {
    return maximum
  }

  const value = DIGITS_RE.test(raw) ? Number(raw) : Number.NaN

  return Number.isInteger(value) && value > 0 && value <= maximum ? value : null
}

/** An epoch-ms cursor (`before`); `null` when it is not a safe non-negative integer (400). */
function parseEpochMs(raw: string): number | null {
  const value = DIGITS_RE.test(raw) ? Number(raw) : Number.NaN

  return Number.isSafeInteger(value) ? value : null
}

interface PageLimits {
  readonly defaultLimit: number
  readonly maximumLimit: number
  /** True when `beforeId` breaks the tie between rows of one instant. */
  readonly keyset: boolean
}

interface PageQuery {
  readonly limit: number
  readonly before?: number
  readonly beforeId?: string
}

/** `limit`, `before` (epoch ms) and, where the list is a keyset, the `beforeId` of the last row a page
 *  showed: it only makes sense beside `before`. `null` when any is malformed (400). */
export function parsePageQuery(params: URLSearchParams, limits: PageLimits): PageQuery | null {
  const rawLimit = params.get('limit')
  const rawBefore = params.get('before')
  const rawBeforeId = limits.keyset ? params.get('beforeId') : null
  const limit = rawLimit === null ? limits.defaultLimit : parseLimit(rawLimit, limits.maximumLimit)
  const before = rawBefore === null ? undefined : parseEpochMs(rawBefore)

  if (
    limit === null ||
    before === null ||
    (rawBeforeId !== null && (before === undefined || !CURSOR_ID_RE.test(rawBeforeId)))
  ) {
    return null
  }

  return {
    limit,
    ...(before === undefined ? {} : { before }),
    ...(rawBeforeId === null ? {} : { beforeId: rawBeforeId }),
  }
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

/** A name as a surface types it: the ticker, and the market when it said which. `null` when either
 *  is malformed (400). */
export function parseTickerRequest(raw: {
  readonly ticker: string
  readonly market?: string | undefined
}): {
  readonly ticker: ReturnType<typeof ticker>
  readonly market?: ReturnType<typeof marketRef>
} | null {
  try {
    return {
      ticker: ticker(raw.ticker),
      ...(raw.market === undefined ? {} : { market: marketRef(raw.market) }),
    }
  } catch {
    return null
  }
}

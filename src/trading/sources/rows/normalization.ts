import { z } from 'zod'

import type { Caveat } from '@/trading/kernel/caveat'
import type { TradingDay } from '@/trading/kernel/instrument'
import type { Candle } from '@/trading/kernel/market/market-data'
import { ValidationError } from '@/core/errors'
import { hasBlockingThreat, scanOutput, toVisibleText } from '@/core/security/sanitize'
import { MS_PER_DAY, MS_PER_SECOND } from '@/core/utils/time'
import { tradingDay } from '@/trading/kernel/instrument'

/** Rows stay `unknown` so a page is never rejected over one row's contents. */
const PAGE = z.object({ data: z.array(z.unknown()) })

/** Campaign parameters, not addressing: two urls differing only by these are one story. `at_*` is
 *  the BBC's family. */
const TRACKING_QUERY_KEYS: ReadonlySet<string> = new Set([
  'fbclid',
  'gclid',
  'at_medium',
  'at_campaign',
  'at_custom1',
  'at_custom2',
  'at_custom3',
  'at_custom4',
  'at_bbc_team',
])
const UTC_TIMEZONE = 'UTC'
const YEAR_LENGTH = 4
const END_OF_DAY_OFFSET_MS = MS_PER_DAY - 1
// Unicode-aware: an industry name may arrive in Vietnamese, which an ASCII class would erase.
const SECTOR_SEPARATOR_RE = /[^\p{L}\p{N}]+/gu
const SECTOR_EDGE_HYPHEN_RE = /^-|-$/g

/** A VN mid-cap files every few days to weeks, so a 48-hour window left most names debating with no
 *  headlines at all. Each row carries its own date, so a persona weighs staleness itself. */
export const NEWS_MAXIMUM_AGE_MS = 14 * MS_PER_DAY

/** Wire-unit conversions every adapter shares, so six files cannot name the same factor three
 *  different ways. `THOUSAND_VND_PER_UNIT`: VNDirect, Entrade, and the domestic gold boards quote
 *  VN prices in thousands of VND, while turnover, flow, and fee fields are already VND. */
export const PERCENT_PER_UNIT = 100
export const THOUSAND_VND_PER_UNIT = 1_000
/** What a board quoting "14.970" for a 149,700,000 VND lượng means by one unit. */
export const TEN_THOUSAND_VND_PER_UNIT = 10_000

/** Rows a kline request asks for when the caller names no window. Every venue's own ceiling is
 *  higher, so this bounds the ask rather than the venue. */
const DEFAULT_KLINES = 250

// Intl formatter construction is expensive; one per timezone, cached. Only a zone that constructed
// is stored, so a provider-supplied name cannot grow the map.
const DAY_FORMATTERS = new Map<string, Intl.DateTimeFormat>()

interface SanitizedText {
  readonly value: string
  readonly caveats: readonly Caveat[]
}

export function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(`${label} is not a finite number`)
  }

  return value
}

export function positive(value: unknown, label: string): number {
  const parsed = finite(value, label)

  if (parsed <= 0) {
    throw new ValidationError(`${label} must be positive`)
  }

  return parsed
}

export function nonNegative(value: unknown, label: string): number {
  const parsed = finite(value, label)

  if (parsed < 0) {
    throw new ValidationError(`${label} must not be negative`)
  }

  return parsed
}

/** Absent when there is nothing to measure against, which is not the same claim as a flat day. */
export function dayChangePct(close: number, previousClose: number | undefined): number | undefined {
  return previousClose === undefined || previousClose === 0
    ? undefined
    : ((close - previousClose) / previousClose) * PERCENT_PER_UNIT
}

/** The move between the two readings a surface actually prints, falling back to the provider's own
 *  figure only where there is no close to measure against. A rolling 24h window measures from a
 *  price that appears nowhere on screen, so beside a dated close it reads as a contradiction. */
export function changeAgainstClose(
  price: number,
  previousClose: number | undefined,
  reported: number | undefined
): number | undefined {
  return dayChangePct(price, previousClose) ?? reported
}

/** The provider's own published move, kept only when it is a usable number. Absent for a coin
 *  listed inside the window, which has no prior close to move from. */
export function publishedChangePct(value: number | null | undefined): { changePct?: number } {
  const pct = finitePct(value)

  return pct === undefined ? {} : { changePct: pct }
}

export function publishedWeekChangePct(value: number | null | undefined): { change7dPct?: number } {
  const pct = finitePct(value)

  return pct === undefined ? {} : { change7dPct: pct }
}

function finitePct(value: number | null | undefined): number | undefined {
  return value === null || value === undefined || !Number.isFinite(value) ? undefined : value
}

export function dayFromEpochSeconds(seconds: unknown, timezone: string): TradingDay {
  const parsed = finite(seconds, 'timestamp')
  const formatter = dayFormatter(timezone)

  return tradingDay(formatter.format(new Date(parsed * MS_PER_SECOND)))
}

/** An unknown zone throws `RangeError`, which would escape `dropInvalid` the way a `TypeError` does.
 *  Callers that read a zone off a provider payload need it typed as a row-level rejection. */
function dayFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = DAY_FORMATTERS.get(timezone)

  if (cached) {
    return cached
  }

  if (!isUsableTimezone(timezone)) {
    throw new ValidationError(`unknown timezone: ${timezone}`)
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  DAY_FORMATTERS.set(timezone, formatter)

  return formatter
}

/** Construction is the only membership test Intl offers; an unknown zone throws `RangeError`. */
export function isUsableTimezone(timezone: string): boolean {
  try {
    const probe = new Intl.DateTimeFormat('en-CA', { timeZone: timezone })

    return probe.resolvedOptions().timeZone.length > 0
  } catch {
    return false
  }
}

/** For providers whose window is scoped by calendar year rather than by day. */
export function yearOf(day: TradingDay): number {
  return Number(day.slice(0, YEAR_LENGTH))
}

export function utcDayStartEpochMs(day: TradingDay): number {
  return Date.parse(`${day}T00:00:00.000Z`)
}

export function utcDayEndEpochMs(day: TradingDay): number {
  return utcDayStartEpochMs(day) + END_OF_DAY_OFFSET_MS
}

export function utcDayStartEpochSeconds(day: TradingDay): number {
  return Math.floor(utcDayStartEpochMs(day) / MS_PER_SECOND)
}

export function utcDayEndEpochSeconds(day: TradingDay): number {
  return Math.floor(utcDayEndEpochMs(day) / MS_PER_SECOND)
}

/** The UTC day an instant falls in, for providers whose day is the UTC day. */
export function utcDayOf(epochMs: number): TradingDay {
  return dayFromEpochSeconds(epochMs / MS_PER_SECOND, UTC_TIMEZONE)
}

/** Parallel-array series are zipped by position, so a column short of the others silently pairs one
 *  session's open with another's close. Rejecting the payload is the only way to catch that — the
 *  per-row guards see a well-formed candle that never traded. */
export function assertParallelColumns(
  columns: readonly (readonly unknown[])[],
  label: string
): void {
  const [first, ...rest] = columns

  if (first === undefined || rest.some((column) => column.length !== first.length)) {
    throw new ValidationError(`${label} columns have unequal lengths`)
  }
}

// The shape an adapter has already assembled (day resolved, adjustment decided); toCandle owns the
// numeric and range validation only.
interface CandleInput {
  readonly at: TradingDay
  readonly open: unknown
  readonly high: unknown
  readonly low: unknown
  readonly close: unknown
  readonly volume?: unknown
  readonly turnover?: unknown
  readonly takerBuyVolume?: unknown
  readonly adjustment: Candle['adjustment']
}

/** Provider bars arrive as parallel arrays or row objects; both land here so the OHLC invariant is
 *  checked exactly once for every provider. */
export function toCandle(input: CandleInput): Candle {
  const open = positive(input.open, 'open')
  const high = positive(input.high, 'high')
  const low = positive(input.low, 'low')
  const close = positive(input.close, 'close')

  if (high < low || high < open || high < close || low > open || low > close) {
    throw new ValidationError('impossible OHLC range')
  }

  return {
    at: input.at,
    open,
    high,
    low,
    close,
    volume: nonNegative(input.volume, 'volume'),
    ...(input.turnover === undefined ? {} : { turnover: nonNegative(input.turnover, 'turnover') }),
    ...(input.takerBuyVolume === undefined
      ? {}
      : { takerBuyVolume: nonNegative(input.takerBuyVolume, 'takerBuyVolume') }),
    adjustment: input.adjustment,
  }
}

/** Every provider string crosses this boundary before it becomes a domain value: news reaches a
 *  model as debate evidence, so an unsanitized headline is a prompt injection with a trade
 *  suggestion at the other end. A string that changes here is caveated, never silently rewritten.
 *  Markup escaping belongs to `OutputPipeline`, which escapes every tool result on its way to the
 *  model; doing it here too would double-encode there and store the escaped form everywhere else. */
export function untrustedText(raw: string, label: string): SanitizedText {
  const threats = scanOutput(raw)

  // A block-severity pattern is a malformed row, dropped like an impossible OHLC range.
  if (hasBlockingThreat(threats)) {
    throw new ValidationError(`${label} contains a blocked pattern`)
  }

  const clean = toVisibleText(raw)

  return clean === raw && threats.length === 0
    ? { value: raw, caveats: [] }
    : { value: clean, caveats: [{ code: 'source.content-sanitized', detail: { field: label } }] }
}

export function canonicalUrl(raw: string): string {
  // `URL.parse` rather than the constructor: a relative or malformed href throws `TypeError`, which
  // `dropInvalid` rethrows, costing the whole fetch over one row.
  const url = URL.parse(raw)

  if (url === null) {
    throw new ValidationError('news url is not parseable')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError(`unsupported news url scheme: ${url.protocol}`)
  }

  url.hash = ''

  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith('utm_') || TRACKING_QUERY_KEYS.has(key)) {
      url.searchParams.delete(key)
    }
  }

  return url.toString()
}

/** A provider does not spell an industry the same way twice (`Oil & Gas`, `OIL  &  GAS`), so the
 *  sector is folded once here: a policy constant, a cap bucket, a rotation bucket, and a locale key
 *  then compare one slug. Absent when the name carried no letter or digit. */
export function canonicalSector(raw: string): string | undefined {
  const canonical = raw
    .toLowerCase()
    .replace(SECTOR_SEPARATOR_RE, '-')
    .replace(SECTOR_EDGE_HYPHEN_RE, '')

  return canonical === '' ? undefined : canonical
}

/** Throws on a missing or future date rather than substituting `now`: a fabricated timestamp
 *  would make stale news look current. */
export function publishedAt(raw: unknown, now: number, maximumAgeMs: number): number {
  const parsed = typeof raw === 'string' ? Date.parse(raw) : Number.NaN

  if (!Number.isFinite(parsed)) {
    throw new ValidationError('news item has no usable publication time')
  }

  if (parsed > now) {
    throw new ValidationError('news item is dated in the future')
  }

  if (now - parsed > maximumAgeMs) {
    throw new ValidationError('news item is older than the accepted window')
  }

  return parsed
}

/** Rows unfiltered, so the count stays the one `getJsonPages` pages on: it stops at a page shorter
 *  than it asked for, and dropping rows here would read as a short page and end the series early.
 *  Row shape is checked per row instead, by the mapper `dropInvalid` guards. */
export function pageRows(raw: unknown): readonly unknown[] {
  return PAGE.parse(raw).data
}

/** Turns a schema mismatch into the `ValidationError` `dropInvalid` drops, so one bad row costs
 *  that row and nothing else. */
export function parseRow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw)

  if (!parsed.success) {
    throw new ValidationError(`${label} row does not match its schema`)
  }

  return parsed.data
}

/** How many rows a fold keeps: the caller's limit, bounded by what one fetch can hold. */
export function boundedRowCount(
  limit: number | undefined,
  bounds: { readonly fallback: number; readonly maximum: number }
): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) {
    return bounds.fallback
  }

  return Math.min(bounds.maximum, Math.floor(limit))
}

/** One malformed item must not reject the whole fetch and trip the provider's breaker. Validation
 *  errors drop the row; anything else still throws. */
export function dropInvalid<TRaw, TMapped>(
  rows: readonly TRaw[],
  map: (row: TRaw) => TMapped
): TMapped[] {
  const out: TMapped[] = []

  for (const row of rows) {
    try {
      out.push(map(row))
    } catch (err: unknown) {
      if (!(err instanceof ValidationError)) {
        throw err
      }
    }
  }

  return out
}

/** Frozen code-table lookup. The `hasOwn` guard is what makes the index safe, and keeping it in one
 *  place means each adapter's mapping table states only the mapping. */
export function fromCodeTable<T>(table: Readonly<Record<string, T>>, code: string): T | undefined {
  return Object.hasOwn(table, code) ? table[code] : undefined
}

/** What a kline page is asked for. `SourceContext` satisfies it. */
interface KlinePage {
  readonly fromDay?: TradingDay
  readonly toDay?: TradingDay
  readonly limit?: number
}

/** How many rows a kline page must hold: a dated window's own span, because a page shorter than the
 *  window drops rows at whichever end the venue trims — the newest ones on a venue that answers a
 *  `startTime` page oldest-first, which every reader then sees as a series a session stale.
 *  `maximum` is the venue's ceiling, which differs per adapter. A request naming no window falls
 *  back to the caller's row count, and then to the default rather than an unbounded page. */
export function klineLimit(page: KlinePage, maximum: number): number {
  const rows = inclusiveDays(page) ?? page.limit

  if (rows === undefined || !Number.isFinite(rows) || rows <= 0) {
    return DEFAULT_KLINES
  }

  return Math.min(maximum, Math.floor(rows))
}

function inclusiveDays(page: KlinePage): number | undefined {
  const { fromDay, toDay } = page

  if (fromDay === undefined || toDay === undefined) {
    return undefined
  }

  return (utcDayStartEpochMs(toDay) - utcDayStartEpochMs(fromDay)) / MS_PER_DAY + 1
}

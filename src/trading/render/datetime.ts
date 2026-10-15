import type { Locale } from '@/core/types/locale'
import { DATE_ORDER_LOCALES, DAY_PARTS, formatDay } from '@/i18n'

const ISO_DAY_LENGTH = 10
const TRADING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Whether a stored string is a trading day, so a renderer can put it in the reader's date order
 *  instead of printing the ISO form a column holds it in. */
export function isTradingDayText(value: string): boolean {
  return TRADING_DAY_RE.test(value)
}

/** One day, or a run of them a caller already joined. The separator is theirs, so it arrives rather
 *  than being assumed; absent means the value names no day, which is every ticker list. */
export function renderTradingDays(
  locale: Locale,
  value: string,
  separator: string
): string | undefined {
  const parts = value.split(separator)

  if (!parts.some(isTradingDayText)) {
    return undefined
  }

  return parts
    .map((part) => (isTradingDayText(part) ? formatDay(locale, part) : part))
    .join(separator)
}

const CLOCK_PARTS: Intl.DateTimeFormatOptions = Object.freeze({
  hour: '2-digit',
  minute: '2-digit',
})

/** One cache per shape, keyed by everything the formatter is built from, so a formatter is
 *  constructed once and never rebuilt per row. Each caller owns a map whose keys are closed —
 *  locale × timezone, locale × unit — so every cache is bounded by construction. */
export function cachedFormatter<T>(cache: Map<string, T>, key: string, build: () => T): T {
  const cached = cache.get(key)

  if (cached !== undefined) {
    return cached
  }

  const formatter = build()

  cache.set(key, formatter)

  return formatter
}

// Same bounded-by-construction reasoning as the day formatters above.
const clockFormatters = new Map<string, Intl.DateTimeFormat>()

/** An instant on the operator's own clock, in the operator's locale. Every rendered time reads in
 *  the one zone `[locale] timezone` declares, so a message never asks its reader to hold two clocks
 *  at once — a market's *trading day* stays its own, because a close is dated by the session that
 *  produced it rather than by where it was read. */
export function formatClock(locale: Locale, at: number, timezone: string): string {
  const formatter = cachedFormatter(
    clockFormatters,
    `${locale}|${timezone}`,
    () =>
      new Intl.DateTimeFormat(DATE_ORDER_LOCALES[locale], { ...CLOCK_PARTS, timeZone: timezone })
  )

  return formatter.format(new Date(at))
}

/** An epoch-ms instant as its UTC calendar day, in the day-first form every other date here reads
 *  in. Pinned to UTC because a citation is stamped by its publisher, and a one-day timezone drift
 *  does not change what the source said. */
export function formatPublishedDay(locale: Locale, at: number): string {
  return formatDay(locale, new Date(at).toISOString().slice(0, ISO_DAY_LENGTH))
}

const zonedDayFormatters = new Map<string, Intl.DateTimeFormat>()

/** Day then clock, for a stamp that has to say which session it belongs to as well as when within
 *  it — a board left standing overnight reads as yesterday's, not as this morning's. Composed from
 *  the two parts rather than one pattern, because a combined `Intl` pattern orders them by locale
 *  and every other dated line here reads day first. */
export function formatInstant(locale: Locale, at: number, timezone: string): string {
  const formatter = cachedFormatter(
    zonedDayFormatters,
    `${locale}|${timezone}`,
    () => new Intl.DateTimeFormat(DATE_ORDER_LOCALES[locale], { ...DAY_PARTS, timeZone: timezone })
  )

  return `${formatter.format(new Date(at))} ${formatClock(locale, at, timezone)}`
}

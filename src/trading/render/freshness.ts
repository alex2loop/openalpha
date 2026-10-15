import type { Locale } from '@/core/types/locale'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { PriceFreshness } from '@/trading/kernel/operator/book'
import { formatDay, t } from '@/i18n'
import { formatClock } from '@/trading/render/datetime'

/** The freshness vocabulary every surface shares (the strings live under the portfolio keys): a
 *  live mark names its clock time so it can be checked, a settled one names its session. */
export function renderFreshness(
  locale: Locale,
  freshness: PriceFreshness | undefined,
  timezone: string
): string {
  if (freshness === undefined) {
    return ''
  }

  const day = formatDay(locale, freshness.day)

  if (freshness.markKind === 'live' && freshness.observedAt !== undefined) {
    return ` · ${t(locale, 'trading.render.portfolio.markedLive', {
      day,
      time: formatClock(locale, freshness.observedAt, timezone),
    })}`
  }

  return ` · ${t(locale, 'trading.render.portfolio.markedOn', { day })}`
}

/** The one sentence every surface uses for how fresh a price is. A live read names its clock time,
 *  which is what makes it checkable; a close names its session, which is what makes it old. */
export function renderQuoteFreshness(
  locale: Locale,
  observed: QuoteFreshness,
  options: { readonly timezone: string }
): string {
  if (observed.kind === 'close') {
    return t(locale, 'trading.render.freshness.close', {
      day: formatDay(locale, observed.day),
    })
  }

  return t(locale, 'trading.render.freshness.live', {
    time: formatClock(locale, observed.observedAt, options.timezone),
  })
}

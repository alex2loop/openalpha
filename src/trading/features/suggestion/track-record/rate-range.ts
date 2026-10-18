import type { Locale } from '@/core/types/locale'
import { t } from '@/i18n'
import { wilsonInterval } from '@/trading/markets/timeseries'

interface WinCounts {
  readonly winCount: number
  readonly resolvedCount: number
}

/** How sure a win rate is, in the same format as the rate it sits beside. Empty without a
 *  population, which no rate line prints for. */
export function renderRateRange(
  locale: Locale,
  counts: WinCounts,
  format: (locale: Locale, fraction: number) => string
): string {
  const interval = wilsonInterval(counts.winCount, counts.resolvedCount)

  if (interval === undefined) {
    return ''
  }

  return t(locale, 'trading.render.reflect.rateRange', {
    low: format(locale, interval.low),
    high: format(locale, interval.high),
  })
}

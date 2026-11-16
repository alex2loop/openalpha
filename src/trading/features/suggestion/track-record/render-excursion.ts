import type { Locale } from '@/core/types/locale'
import type { ExcursionSummary } from '@/trading/features/suggestion/track-record/types'
import { t } from '@/i18n'
import { formatCount, formatRatio } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

/** How far the price ran against the calls that won and lost, and for the ones the stop closed, as
 *  one line. Each figure is guarded on its own: a short group is left out and the measured ones
 *  stay. */
export function renderExcursionSection(
  locale: Locale,
  excursions: ExcursionSummary
): readonly string[] {
  const parts = [
    excursions.winnersAdverse === undefined
      ? undefined
      : t(locale, 'trading.render.reflect.excursionWinners', {
          value: formatRatio(locale, excursions.winnersAdverse),
          n: formatCount(locale, excursions.winnersCount),
        }),
    excursions.losersAdverse === undefined
      ? undefined
      : t(locale, 'trading.render.reflect.excursionLosers', {
          value: formatRatio(locale, excursions.losersAdverse),
          n: formatCount(locale, excursions.losersCount),
        }),
    excursions.stoppedFavorable === undefined
      ? undefined
      : t(locale, 'trading.render.reflect.excursionStopped', {
          value: formatRatio(locale, excursions.stoppedFavorable),
          n: formatCount(locale, excursions.stoppedCount),
        }),
  ].filter((part) => part !== undefined)

  if (parts.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.reflect.excursion', { parts: parts.join(INLINE_SEPARATOR) })}`,
  ]
}

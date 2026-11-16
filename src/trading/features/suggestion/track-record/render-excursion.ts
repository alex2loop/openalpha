import type { Locale } from '@/core/types/locale'
import type { MessageKey } from '@/i18n'
import type { ExcursionSummary } from '@/trading/features/suggestion/track-record/types'
import { t } from '@/i18n'
import { formatCount, formatRatio } from '@/trading/render/format'
import { INDENT, INLINE_SEPARATOR } from '@/trading/render/layout'

interface ExcursionFigure {
  readonly key: MessageKey
  readonly value: number | undefined
  readonly count: number
}

/** How far the price ran against the calls that won and lost, and for the ones the stop closed, as
 *  one line. Each figure is guarded on its own: a short group is left out and the measured ones
 *  stay. */
export function renderExcursionSection(
  locale: Locale,
  excursions: ExcursionSummary
): readonly string[] {
  const parts = [
    excursionPart(locale, {
      key: 'trading.render.reflect.excursionWinners',
      value: excursions.winnersAdverse,
      count: excursions.winnersCount,
    }),
    excursionPart(locale, {
      key: 'trading.render.reflect.excursionLosers',
      value: excursions.losersAdverse,
      count: excursions.losersCount,
    }),
    excursionPart(locale, {
      key: 'trading.render.reflect.excursionStopped',
      value: excursions.stoppedFavorable,
      count: excursions.stoppedCount,
    }),
  ].filter((part) => part !== undefined)

  if (parts.length === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.reflect.excursion', { parts: parts.join(INLINE_SEPARATOR) })}`,
  ]
}

function excursionPart(locale: Locale, figure: ExcursionFigure): string | undefined {
  return figure.value === undefined
    ? undefined
    : t(locale, figure.key, {
        value: formatRatio(locale, figure.value),
        n: formatCount(locale, figure.count),
      })
}

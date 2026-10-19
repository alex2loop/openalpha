import type { Locale } from '@/core/types/locale'
import type { ActedSummary } from '@/trading/features/suggestion/track-record/acted'
import { t } from '@/i18n'
import { formatCount, formatSignedFraction, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'

export function renderActedLines(
  locale: Locale,
  acted: ActedSummary | undefined
): readonly string[] {
  if (acted === undefined || acted.resolvedCount === 0) {
    return []
  }

  const { actedMeanReturnPct, passedMeanReturnPct, shortfallPct } = acted

  return [
    renderSectionTitle(SECTION_ICONS.acted, t(locale, 'trading.render.reflect.actedHeading')),
    `${INDENT[1]}${t(locale, 'trading.render.reflect.actedLine', {
      acted: formatCount(locale, acted.actedCount),
      n: formatCount(locale, acted.resolvedCount),
    })}`,
    ...(actedMeanReturnPct === undefined || passedMeanReturnPct === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.reflect.actedReturns', {
            actedAvg: formatSignedFraction(locale, actedMeanReturnPct),
            passedAvg: formatSignedFraction(locale, passedMeanReturnPct),
          })}`,
        ]),
    ...(shortfallPct === undefined
      ? []
      : [
          `${INDENT[1]}${t(locale, 'trading.render.reflect.actedShortfall', {
            gap: formatSignedFraction(locale, shortfallPct),
          })}`,
        ]),
  ]
}

import type { Locale } from '@/core/types/locale'
import type { ShadowSummary } from '@/trading/features/suggestion/track-record/types'
import { t } from '@/i18n'
import { renderCaveatLines } from '@/trading/render/caveat'
import { formatCount, formatFraction, formatSignedFraction } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** What the record would have done to a book that took every call at the size it named. Sequential
 *  contribution, so it answers "how much did this move me", not "what would I have compounded" —
 *  and it describes the window `/reflect` asked for, not all time. */
export function renderShadowSection(locale: Locale, shadow: ShadowSummary): readonly string[] {
  if (shadow.sizedCount === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.reflect.shadow', {
      total: formatSignedFraction(locale, shadow.totalContribution),
      drawdown: formatFraction(locale, shadow.worstDrawdown),
      sized: formatCount(locale, shadow.sizedCount),
      n: formatCount(locale, shadow.sizedCount + shadow.unsizedCount),
    })}`,
    ...renderCaveatLines(locale, shadow.caveats),
  ]
}

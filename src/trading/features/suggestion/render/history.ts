import type { Locale } from '@/core/types/locale'
import type { ResolvedActionableSuggestion } from '@/trading/features/suggestion/types'
import { formatDay, t } from '@/i18n'
import { formatSignedFixedFraction, renderDeclaredValue } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** What the most recently closed call on this name did, dated by both the day it was made and the
 *  day it closed. One line, and only when a closed one exists: a first call on a ticker has no
 *  record to stand on and must not imply one. */
export function renderHistoryLines(
  locale: Locale,
  previous: ResolvedActionableSuggestion | undefined
): readonly string[] {
  if (previous === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.suggestion.lastCall', {
      ticker: previous.instrument.ticker,
      callDay: formatDay(locale, previous.at),
      exitDay: formatDay(locale, previous.outcome.exitDay),
      action: renderDeclaredValue(locale, `trading.action.${previous.action}`),
      returnPct: formatSignedFixedFraction(locale, previous.outcome.returnPct),
    })}`,
  ]
}

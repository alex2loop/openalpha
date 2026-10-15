import type { Locale } from '@/core/types/locale'
import type { TrackRecordCoverage } from '@/trading/features/suggestion/track-record/types'
import { t } from '@/i18n'
import { formatCount } from '@/trading/render/format'
import { INDENT } from '@/trading/render/layout'

/** The denominator, above the numbers it qualifies. Kept out of `renderOverallLines`, which prints
 *  nothing when no row has scored - the state where this is the only figure left to report. */
export function renderCoverageLine(
  locale: Locale,
  coverage: TrackRecordCoverage
): readonly string[] {
  if (coverage.actionable === 0) {
    return []
  }

  const counts = {
    made: formatCount(locale, coverage.actionable),
    resolved: formatCount(locale, coverage.resolved),
    pending: formatCount(locale, coverage.pending),
  }

  const line =
    coverage.unresolvable === 0
      ? t(locale, 'trading.render.reflect.coverage', counts)
      : t(locale, 'trading.render.reflect.coverageUnresolvable', {
          ...counts,
          unresolvable: formatCount(locale, coverage.unresolvable),
        })

  return [
    `${INDENT[1]}${line}`,
    ...renderRestatedLine(locale, coverage.restated),
    ...renderUnfilledLine(locale, coverage.unfilled),
  ]
}

/** Otherwise `made` would exceed what played out plus what is open, with nothing saying why. */
function renderRestatedLine(locale: Locale, restated: number): readonly string[] {
  if (restated === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.reflect.coverageRestated', {
      restated: formatCount(locale, restated),
    })}`,
  ]
}

function renderUnfilledLine(locale: Locale, unfilled: number): readonly string[] {
  if (unfilled === 0) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, 'trading.render.reflect.coverageUnfilled', {
      unfilled: formatCount(locale, unfilled),
    })}`,
  ]
}

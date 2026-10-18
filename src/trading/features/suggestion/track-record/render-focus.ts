import type { Locale } from '@/core/types/locale'
import type {
  AgentRecordView,
  FocusRecordView,
  FocusSummary,
} from '@/trading/features/suggestion/track-record/agent-record'
import type { FocusAgreement } from '@/trading/features/suggestion/track-record/agreement'
import { formatDay, pluralKey, t } from '@/i18n'
import { hasAgreementSample } from '@/trading/features/suggestion/track-record/agreement'
import { renderRateRange } from '@/trading/features/suggestion/track-record/rate-range'
import { renderFocusLabel } from '@/trading/render/focus'
import { formatCount, formatFraction, SECTION_ICONS } from '@/trading/render/format'
import { INDENT, renderSectionTitle } from '@/trading/render/layout'

interface Counts {
  readonly resolvedCount: number
  readonly winCount: number
  readonly winRate?: number
}

function countParams(locale: Locale, counts: Counts): Record<string, string> {
  return {
    count: formatCount(locale, counts.resolvedCount),
    wins: formatCount(locale, counts.winCount),
    rate: counts.winRate === undefined ? '' : formatFraction(locale, counts.winRate),
    range: counts.winRate === undefined ? '' : renderRateRange(locale, counts, formatFraction),
  }
}

/** A record under a label of its own, one row of `/reflect`'s block. */
function recordLine(locale: Locale, view: FocusSummary): string {
  const params = { ...countParams(locale, view), label: renderFocusLabel(locale, view.focus) }

  return view.winRate === undefined
    ? t(
        locale,
        pluralKey(view.resolvedCount, 'trading.focus.recordEarlyOne', 'trading.focus.recordEarly'),
        params
      )
    : t(locale, 'trading.focus.record', params)
}

/** The same record with no name in front, for a line that already sits under one. */
function ownRecordLine(locale: Locale, counts: Counts): string {
  const params = countParams(locale, counts)

  return counts.winRate === undefined
    ? t(
        locale,
        pluralKey(
          counts.resolvedCount,
          'trading.focus.recordOwnEarlyOne',
          'trading.focus.recordOwnEarly'
        ),
        params
      )
    : t(locale, 'trading.focus.recordOwn', params)
}

/** How often a focus takes the action the others take, and what its disagreements earned. Absent
 *  agreement is its own sentence, so a lone agent never reads as agreeing with nobody. */
function renderAgreementLines(
  locale: Locale,
  agreement: FocusAgreement | undefined
): readonly string[] {
  if (agreement === undefined || agreement.comparedCount === 0) {
    return [t(locale, 'trading.focus.agreementNone')]
  }

  const count = formatCount(locale, agreement.comparedCount)

  if (!hasAgreementSample(agreement)) {
    return [
      t(
        locale,
        pluralKey(
          agreement.comparedCount,
          'trading.focus.agreementEarlyOne',
          'trading.focus.agreementEarly'
        ),
        { count }
      ),
    ]
  }

  return [
    t(locale, 'trading.focus.agreement', {
      pct: formatFraction(locale, agreement.matchedCount / agreement.comparedCount),
      count,
    }),
    ...(agreement.contrarianCount === 0
      ? []
      : [
          t(
            locale,
            pluralKey(
              agreement.contrarianCount,
              'trading.focus.contrarianOne',
              'trading.focus.contrarian'
            ),
            {
              count: formatCount(locale, agreement.contrarianCount),
              mine: formatCount(locale, agreement.contrarianWins),
              crowd: formatCount(locale, agreement.crowdWins),
            }
          ),
        ]),
  ]
}

function overlapLine(locale: Locale, left: string, right: string): string {
  return t(locale, 'trading.focus.overlap', { left, right })
}

/** `/reflect`'s block: one row per focus with its record, how it agrees with the others, and a hint
 *  where two of them read as the same view. Absent while the operator's own focus is the only one. */
export function renderFocusLines(
  locale: Locale,
  focuses: readonly FocusRecordView[] | undefined
): readonly string[] {
  if (focuses === undefined || focuses.length < 2) {
    return []
  }

  const labels = new Map(
    focuses.map((view) => [view.focusKey, renderFocusLabel(locale, view.focus)])
  )

  return [
    renderSectionTitle(SECTION_ICONS.reflect, t(locale, 'trading.focus.title')),
    ...focuses.flatMap((view) => [
      `${INDENT[1]}${recordLine(locale, view)}`,
      ...renderAgreementLines(locale, view.agreement).map((line) => `${INDENT[2]}${line}`),
    ]),
    ...focuses
      .flatMap((view) => view.overlapsWith.map((other) => [view.focusKey, other] as const))
      .filter(([left, right]) => left < right)
      .map(
        ([left, right]) =>
          `${INDENT[1]}${overlapLine(locale, labels.get(left) ?? left, labels.get(right) ?? right)}`
      ),
  ]
}

/** One agent as `agent list` and `agent show` print it under its name and focus: what it has
 *  earned, how it agrees with the others, and who it overlaps. */
export function renderAgentRecordLines(
  locale: Locale,
  view: AgentRecordView | undefined
): readonly string[] {
  if (view === undefined || view.byFocus.length === 0) {
    return [t(locale, 'trading.focus.agreementNone')]
  }

  const history = view.byFocus.length > 1 ? view.byFocus : []

  return [
    ownRecordLine(locale, view.combined),
    ...renderAgreementLines(locale, view.agreement),
    ...history.map((entry) =>
      t(locale, 'trading.focus.history', {
        from: formatDay(locale, entry.firstSeenDay),
      })
    ),
    ...view.overlapsWith.map((other) => overlapLine(locale, view.agentId, other)),
  ]
}

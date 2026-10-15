import type { Locale } from '@/core/types/locale'
import type { VenueReconciliation } from '@/trading/features/portfolio/folds/reconcile'
import type { RenderContext } from '@/trading/render/format'
import { t } from '@/i18n'
import {
  formatQuantity,
  formatSignedQuantity,
  renderVenueName,
  SECTION_ICONS,
} from '@/trading/render/format'
import { INDENT, joinSections, renderSectionTitle, toFactLines } from '@/trading/render/layout'

/** The sentences a reading carries beyond its venue rows, each present only where it is true.
 *  `matched` claims nothing where no venue answered: "your book matches" over a page of venues
 *  that were never asked is the silence this section exists to break. `cashNote` is only where a
 *  row could be read as a cash break. */
export interface ReconcileSentences {
  readonly matched: string | null
  readonly cashNote: string | null
}

export function reconcileSentences(
  locale: Locale,
  reconciliations: readonly VenueReconciliation[]
): ReconcileSentences {
  const hasBreaks = reconciliations.some((entry) => entry.mismatches.length > 0)
  const answered = reconciliations.some((entry) => entry.uncompared === undefined)

  return {
    matched: !hasBreaks && answered ? t(locale, 'trading.render.reconcile.matched') : null,
    cashNote: hasBreaks ? t(locale, 'trading.render.reconcile.cashNote') : null,
  }
}

export function renderReconcileText(
  locale: Locale,
  reconciliations: readonly VenueReconciliation[],
  context: RenderContext
): string {
  const breaks = reconciliations.filter((entry) => entry.mismatches.length > 0)
  const sentences = reconcileSentences(locale, reconciliations)

  return joinSections([
    [
      renderSectionTitle(SECTION_ICONS.reconcile, t(locale, 'trading.render.reconcile.title')),
      ...(sentences.matched === null ? [] : [`${INDENT[1]}${sentences.matched}`]),
      ...breaks.flatMap((entry) => renderVenue(locale, entry, context)),
      ...reconciliations.flatMap((entry) => renderUncompared(locale, entry)),
    ],
    sentences.cashNote === null ? [] : [`${INDENT[1]}${sentences.cashNote}`],
  ])
}

function renderUncompared(locale: Locale, entry: VenueReconciliation): readonly string[] {
  const { uncompared } = entry

  if (uncompared === undefined) {
    return []
  }

  return [
    `${INDENT[1]}${t(locale, `trading.render.reconcile.${uncompared}`, {
      venue: renderVenueName(locale, entry.venue),
      variables: entry.missingCredentials?.join(', ') ?? '',
    })}`,
  ]
}

function renderVenue(
  locale: Locale,
  entry: VenueReconciliation,
  context: RenderContext
): readonly string[] {
  return [
    `${INDENT[1]}${renderVenueName(locale, entry.venue)}`,
    ...entry.mismatches.flatMap((asset) =>
      toFactLines(
        [
          asset.asset,
          t(locale, 'trading.render.reconcile.booked', {
            quantity: formatQuantity(locale, asset.booked),
          }),
          t(locale, 'trading.render.reconcile.held', {
            quantity: formatQuantity(locale, asset.held),
          }),
          formatSignedQuantity(locale, asset.delta),
        ],
        context,
        2
      )
    ),
  ]
}

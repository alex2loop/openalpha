import type { BriefActionCode, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import { hasNoBook } from '@/trading/kernel/operator/brief-section'
import { ready } from '@/trading/markets/brief-sections'

/** The one ordered exception to the builder record, because it reads the completed results of
 *  every other section. It emits action **codes**, never a command string: a snapshot holding
 *  `/rebalance` cannot be rendered by the HTTP surface and breaks the moment a command is renamed.
 *  A market's own codes follow the neutral ones. */
export function buildNextActions(
  context: BriefContext,
  sections: readonly BriefSectionResult[],
  marketCodes: readonly BriefActionCode[] = []
): BriefSectionResult {
  const readyKinds = new Set(
    sections.filter((section) => section.status === 'ready').map((section) => section.kind)
  )
  const codes: BriefActionCode[] = []

  if (hasNoBook(sections)) {
    codes.push('record-book')
  }

  if (context.watchlist.length === 0) {
    codes.push('add-watchlist')
  }

  if (readyKinds.has('position-exits')) {
    codes.push('review-portfolio')
  }

  if (readyKinds.has('drift-nudge')) {
    codes.push('rebalance')
  }

  if (readyKinds.has('suggestions') || readyKinds.has('cross-asset-suggestions')) {
    codes.push('review-suggestions')
  }

  if (readyKinds.has('fired-alerts')) {
    codes.push('review-alerts')
  }

  // Ready with no rows, never omitted: this is a core section, so omitting it would suppress the
  // whole brief on a morning that simply needs nothing. The renderer already skips an empty one.
  return ready(
    'next-actions',
    [...codes, ...marketCodes].map((code) => ({ code }))
  )
}

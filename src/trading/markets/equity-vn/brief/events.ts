import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { VnBriefContext } from '@/trading/markets/equity-vn/brief/vn-context'
import { absent, omitted, ready } from '@/trading/markets/brief-sections'

/** Covers what the operator holds as well as what they watch - an ex-date on an unwatched position
 *  is exactly the gap-down that would otherwise read as a loss. The list is capped for display; the
 *  whole calendar it is cut from is `context.events`. */
export async function buildEvents(context: VnBriefContext): Promise<BriefSectionResult> {
  const { rows, caveats, provenance, isComplete } = await context.events()

  if (rows.length === 0) {
    // A quiet calendar is only observable when every target answered.
    return isComplete ? omitted('events') : absent('events', caveats)
  }

  return ready(
    'events',
    rows.slice(0, context.policy.maximumItemsPerSection).map(({ event, instrument }) => ({
      at: event.at,
      ticker: instrument.ticker,
      eventKind: event.kind,
      ...(event.cashPerShare === undefined ? {} : { cashPerShare: event.cashPerShare }),
      ...(event.paysOn === undefined ? {} : { paysOn: event.paysOn }),
      ...(event.shareRatio === undefined ? {} : { shareRatio: event.shareRatio }),
      ...(event.subscriptionPrice === undefined
        ? {}
        : { subscriptionPrice: event.subscriptionPrice }),
    })),
    { caveats, provenance }
  )
}

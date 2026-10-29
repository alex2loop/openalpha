import type { MarketEventKind } from '@/trading/kernel/market/market-event'
import type { BriefActionCode, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import type { EventsRead } from '@/trading/markets/equity-vn/brief/events-read'
import { isAbortError } from '@/core/errors'
import { hasNoBook, sectionNumber } from '@/trading/kernel/operator/brief-section'
import { ready } from '@/trading/markets/equity-vn/brief/sections'
import { VN_STORY_POLICY } from '@/trading/markets/equity-vn/brief/story-policy'
import { VN_MARKET_REF } from '@/trading/markets/equity-vn/policy'
import { CONFIRMING_TURNOVER_RATIO } from '@/trading/markets/overview-sections'

/** The one ordered exception to the builder record, because it reads the completed results of
 *  every other section. It emits action **codes**, never a command string: a snapshot holding `/rebalance`
 *  cannot be rendered by the HTTP surface and breaks the moment a command is renamed. */
export async function buildNextActions(
  context: BriefContext,
  sections: readonly BriefSectionResult[],
  overviews: readonly BriefSectionResult[]
): Promise<BriefSectionResult> {
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

  if (isCrowdedTop(sections, overviews)) {
    codes.push('avoid-chasing')
  }

  const events = await readCalendar(context)

  // Ready with no rows, never omitted: this is a core section, so omitting it would suppress the
  // whole brief on a morning that simply needs nothing. The renderer already skips an empty one.
  return ready('next-actions', [
    ...codes.map((code) => ({ code })),
    ...heldEventTickers(context, events, 'dividend-ex-date').map((ticker) => ({
      ticker,
      code: 'record-dividend' as const,
    })),
    ...heldEventTickers(context, events, 'split').map((ticker) => ({
      ticker,
      code: 'record-distribution' as const,
    })),
  ])
}

/** The whole calendar the events section drew its capped list from. The read is memoised, so a
 *  throw is the events section's own: it comes back unavailable, and this only loses the reminders. */
async function readCalendar(context: BriefContext): Promise<EventsRead['rows']> {
  try {
    return (await context.events()).rows
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return []
  }
}

/** The held names a cash or share dividend goes ex on inside the calendar window: the price drops by
 *  it on the ex-date while the cash or the shares land weeks later, and only a recorded row puts them
 *  in the book. */
function heldEventTickers(
  context: BriefContext,
  events: EventsRead['rows'],
  kind: MarketEventKind
): readonly string[] {
  const held = new Set(context.heldNames.map((instrument) => String(instrument.ticker)))
  const tickers = events.flatMap((row) =>
    row.event.kind === kind && held.has(String(row.instrument.ticker))
      ? [row.instrument.ticker]
      : []
  )

  return [...new Set(tickers)]
}

/** Near resistance on thin turnover, a buy pays up for the level rather than to reach it. "Near" is
 *  the story's own reading of a level test, so the action and the story never disagree. The
 *  tape row comes from the handed builder sections; the range lives only on the overview read,
 *  which the composer already holds — neither is fetched twice. */
function isCrowdedTop(
  sections: readonly BriefSectionResult[],
  overviews: readonly BriefSectionResult[]
): boolean {
  const vnRange = overviews.find(
    (section) => section.kind === 'range' && section.market === VN_MARKET_REF
  )
  const resistancePct =
    vnRange === undefined ? undefined : sectionNumber([vnRange], 'range', 'resistancePct')
  const turnoverRatio = sectionNumber(sections, 'tape', 'turnoverRatio')

  return (
    resistancePct !== undefined &&
    resistancePct <= VN_STORY_POLICY.levelNear &&
    turnoverRatio !== undefined &&
    turnoverRatio < CONFIRMING_TURNOVER_RATIO
  )
}

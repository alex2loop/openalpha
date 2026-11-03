import type { MarketEventKind } from '@/trading/kernel/market/market-event'
import type { BriefActionCode, BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import type { EventsRead } from '@/trading/markets/brief-events'
import { isAbortError } from '@/core/errors'
import { hasNoBook } from '@/trading/kernel/operator/brief-section'
import { ready } from '@/trading/markets/brief-sections'

/** The one ordered exception to the builder record, because it reads the completed results of
 *  every other section. It emits action **codes**, never a command string: a snapshot holding
 *  `/rebalance` cannot be rendered by the HTTP surface and breaks the moment a command is renamed.
 *  A market's own codes follow the neutral ones, and the held names' calendar reminders close it. */
export async function buildNextActions(
  context: BriefContext,
  sections: readonly BriefSectionResult[],
  marketCodes: readonly BriefActionCode[] = []
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

  const events = await readCalendar(context)

  // Ready with no rows, never omitted: this is a core section, so omitting it would suppress the
  // whole brief on a morning that simply needs nothing. The renderer already skips an empty one.
  const omitted = context.deps.omitBriefActions

  return ready('next-actions', [
    ...[...codes, ...marketCodes].filter((code) => !omitted?.has(code)).map((code) => ({ code })),
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

/** The whole calendar the calendar section drew its capped list from. The read is memoised, so a
 *  throw is that section's own: it comes back unavailable, and this only loses the reminders. */
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

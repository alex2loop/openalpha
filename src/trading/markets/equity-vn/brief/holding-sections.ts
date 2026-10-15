import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/equity-vn/brief/context'
import { isAbortError } from '@/core/errors'
import { omitted, ready } from '@/trading/markets/equity-vn/brief/sections'

/** The names `position-exits` cannot speak for: held with no watchable levels. Each ticker is one
 *  `/suggest` run away from coverage. */
export async function buildUnwatchedPositions(context: BriefContext): Promise<BriefSectionResult> {
  const rows = await context.services.unwatchedPositions({
    now: context.request.now,
    signal: context.request.signal,
  })

  return rows.length === 0
    ? omitted('unwatched-positions')
    : ready(
        'unwatched-positions',
        rows.map((instrument) => ({ ticker: instrument.ticker }))
      )
}

/** Held past the window its sleeve is scored over with the price gone nowhere: capital that could be
 *  working elsewhere. Each ticker is one `/suggest stops` run from a fresh read. */
export async function buildStalePositions(context: BriefContext): Promise<BriefSectionResult> {
  const marks = await valuedMarks(context)
  const rows = await context.services.stalePositions({
    now: context.request.now,
    signal: context.request.signal,
    ...(marks === undefined ? {} : { marks }),
  })

  return rows.length === 0
    ? omitted('stale-positions')
    : ready(
        'stale-positions',
        rows.map((instrument) => ({ ticker: instrument.ticker }))
      )
}

/** A failed valuation is the book section's to report; here it only means each price is asked of
 *  the market instead. */
async function valuedMarks(
  context: BriefContext
): Promise<ReadonlyMap<string, number> | undefined> {
  try {
    return (await context.bookSummary())?.marks
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    return undefined
  }
}

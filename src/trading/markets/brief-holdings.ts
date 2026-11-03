import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { StopDistance } from '@/trading/kernel/operator/alert'
import type { BriefSectionResult } from '@/trading/kernel/operator/brief-section'
import type { BriefContext } from '@/trading/markets/brief-context'
import { isAbortError } from '@/core/errors'
import { buildInstrumentKey } from '@/trading/kernel/instrument'
import { stopStandingOf } from '@/trading/kernel/operator/alert'
import { omitted, ready } from '@/trading/markets/brief-sections'

/** The names `position-exits` cannot speak for: held with no watchable levels. Each ticker is one
 *  `/suggest` run away from coverage. */
export async function buildUnwatchedPositions(context: BriefContext): Promise<BriefSectionResult> {
  const rows = await context.services.unwatchedPositions({
    now: context.request.now,
    signal: context.request.signal,
  })

  return tickerSection('unwatched-positions', rows)
}

/** Held past the window its segment is scored over with the price gone nowhere: capital that could be
 *  working elsewhere. Each ticker is one `/suggest stops` run from a fresh read. */
export async function buildStalePositions(context: BriefContext): Promise<BriefSectionResult> {
  const marks = await valuedMarks(context)
  const rows = await context.services.stalePositions({
    now: context.request.now,
    signal: context.request.signal,
    ...(marks === undefined ? {} : { marks }),
  })

  return tickerSection('stale-positions', rows)
}

function tickerSection(
  kind: 'unwatched-positions' | 'stale-positions',
  rows: readonly InstrumentRef[]
): BriefSectionResult {
  return rows.length === 0
    ? omitted(kind)
    : ready(
        kind,
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

type BookSummary = NonNullable<Awaited<ReturnType<BriefContext['bookSummary']>>>
type BookPositionSummary = BookSummary['positions'][number]

/** How much of the book is under water and whether its plans still hold. A state report, never
 *  advice: it counts, it does not tell the operator to sell or to wait. Omitted when nothing is
 *  below cost — there is no reassuring arm worth printing daily. */
export async function buildPositionsInLoss(context: BriefContext): Promise<BriefSectionResult> {
  const book = await context.bookSummary()

  if (book === null) {
    return omitted('positions-in-loss')
  }

  const losing = losingPositions(book)

  if (losing.length === 0) {
    return omitted('positions-in-loss')
  }

  const distances = await context.services.stopDistances({
    now: context.request.now,
    signal: context.request.signal,
    marks: book.marks,
  })
  const stops = stopTally(losing, distances)

  // A stop tally of zero is a count with nothing behind it; the losing count already bounds them.
  return ready('positions-in-loss', [
    {
      losingCount: losing.length,
      losingReturnPct: aggregateReturnPct(losing),
      ...(stops.clear === 0 ? {} : { stopClearCount: stops.clear }),
      ...(stops.breached === 0 ? {} : { stopBreachedCount: stops.breached }),
      ...(stops.unmeasured === 0 ? {} : { stopUnmeasuredCount: stops.unmeasured }),
    },
  ])
}

/** Holdings worth less than was paid for them. */
function losingPositions(book: BookSummary): readonly BookPositionSummary[] {
  return book.positions.filter((position) => position.valueBase < position.costBase)
}

interface StopTally {
  readonly breached: number
  readonly clear: number
  readonly unmeasured: number
}

/** Losing holdings by where each stands against its own stop, looked up above the loop: one map for
 *  the book, never one per row. A holding the watch never measured counts as unmeasured — folded
 *  into `clear` it reported protection nobody compared, and a hold's stop is never a distance. A
 *  host with no stop read (`undefined`) tallies nothing: it states no stop at all. */
function stopTally(
  losing: readonly BookPositionSummary[],
  distances: readonly StopDistance[] | undefined
): StopTally {
  const byInstrument = new Map(
    (distances ?? []).map((distance) => [buildInstrumentKey(distance.instrument), distance])
  )
  const tally = { breached: 0, clear: 0, unmeasured: 0 }

  for (const position of distances === undefined ? [] : losing) {
    const distance = byInstrument.get(buildInstrumentKey(position.instrument))

    tally[distance === undefined ? 'unmeasured' : stopStandingOf(distance)] += 1
  }

  return tally
}

/** The losing leg's own return, cost-weighted: what the under-water part of the book did. */
function aggregateReturnPct(losing: readonly BookPositionSummary[]): number {
  const cost = losing.reduce((sum, position) => sum + position.costBase, 0)
  const value = losing.reduce((sum, position) => sum + position.valueBase, 0)

  return cost <= 0 ? 0 : value / cost - 1
}

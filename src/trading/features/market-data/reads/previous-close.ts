import type { InstrumentRef } from '@/trading/kernel/instrument'
import type { PreviousClose } from '@/trading/kernel/market/market-capability'
import type { QuoteFreshness } from '@/trading/kernel/market/market-data'
import type { Market } from '@/trading/markets/types'
import { isAbortError } from '@/core/errors'
import { dayChangePct } from '@/trading/sources/rows/normalization'

/** Sessions of daily history read to find the close behind a quote — slack for a name halted or a
 *  market shut through several. */
const PREVIOUS_CLOSE_SESSIONS = 10

/** The close this reading stands against, dated by the session that produced it. Read from the
 *  market's own daily series rather than a provider's bare `previousClose`, which no source dates
 *  and two of three do not publish at all. */
export async function settledCloseBefore(
  market: Market,
  instrument: InstrumentRef,
  context: { readonly observed: QuoteFreshness; readonly now: number; readonly signal: AbortSignal }
): Promise<PreviousClose | undefined> {
  const { observed } = context

  // A reference series is another instrument in another unit: its close under this market's live
  // price would read as an overnight move the market never made.
  if (market.manifest.referenceBarsOnly === true) {
    return undefined
  }

  try {
    const bars = await market.capabilities.bars?.run({
      instrument,
      sessions: PREVIOUS_CLOSE_SESSIONS,
      asOf: observed.day,
      now: context.now,
      signal: context.signal,
    })

    if (bars === undefined || bars.kind !== 'available') {
      return undefined
    }

    // A live reading's own day is still trading, so its bar is a partial one and never the close it
    // is measured against; a settled reading *is* that day's close.
    const settled = bars.value.filter((candle) =>
      observed.kind === 'live' ? candle.at < observed.day : candle.at <= observed.day
    )
    const newest = settled.at(-1)

    if (newest === undefined) {
      return undefined
    }

    // What that session moved is close(D) against close(D-1) of this market's own sessions. Absent
    // when D-1 is not in the series: a row with no prior close states the close alone, never zero.
    const previous = settled.at(-2)
    const changePct = dayChangePct(newest.close, previous?.close)

    return {
      price: newest.close,
      at: newest.at,
      ...(changePct === undefined ? {} : { changePct }),
    }
  } catch (err: unknown) {
    if (isAbortError(err)) {
      throw err
    }

    // Best-effort: the quote is the answer, and a series that could not be read costs it a line
    // rather than its price.
    return undefined
  }
}

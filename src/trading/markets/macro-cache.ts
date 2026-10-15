import type { Region, TradingDay } from '@/trading/kernel/instrument'
import type { MacroSnapshot } from '@/trading/kernel/market/market-data'
import type { SourceResult } from '@/trading/kernel/source/source-result'
import type { SourceRegistry } from '@/trading/markets/types'
import { flightCache } from '@/core/utils/concurrency'

/** One live day, plus the slot a run crossing midnight moves into. Every market asks the same
 *  region and day, so more slots would only hold entries nothing reads again. */
const MACRO_CACHE_ENTRIES = 2

type MacroReads = readonly SourceResult<MacroSnapshot>[]

export interface MacroCache {
  get(region: Region, asOf: TradingDay, signal: AbortSignal): Promise<MacroReads>
}

/** One merged macro read per region and day, shared by every market that scores against it: gold
 *  reads it from three capabilities and VN equities from a fourth, all asking the identical
 *  question. */
export function macroCache(sources: SourceRegistry): MacroCache {
  const reads = flightCache<MacroReads>(MACRO_CACHE_ENTRIES, isCompleteRead)

  return {
    get: (region, asOf, signal) =>
      reads.share(`${region}:${asOf}`, signal, () =>
        sources.resolveAll({ kind: 'macro', context: { region, toDay: asOf }, signal })
      ),
  }
}

// The day's first pass runs before the US series publish, and a failed leg is not an answer either;
// only a read with every leg in is worth serving to the next caller.
function isCompleteRead(reads: MacroReads): boolean {
  return reads.every((read) => read.kind === 'available')
}

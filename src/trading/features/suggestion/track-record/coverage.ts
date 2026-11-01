import type { SuggestionCoverageRow } from '@/trading/features/suggestion/store/suggestion-outcome'
import type { TrackRecordCoverage } from '@/trading/features/suggestion/track-record/types'
import type { MarketRegistry } from '@/trading/markets/types'
import { canResolveOutcomes } from '@/trading/features/suggestion/track-record/resolvable'

/** The book's counts per resolution state, with the pending rows no market can ever score split
 *  out. */
export function coverageOf(
  rows: readonly SuggestionCoverageRow[],
  markets: Pick<MarketRegistry, 'find'>
): TrackRecordCoverage {
  const pending = rows.filter((row) => row.state === 'pending')
  // An unknown ref can never score either; reading it as merely pending promises a resolution
  // that never arrives.
  const unresolvable = pending.filter((row) => {
    const market = markets.find(row.market)

    return market === null || !canResolveOutcomes(market)
  })

  return {
    actionable: sumCounts(rows),
    resolved: sumCounts(rows.filter((row) => row.state === 'scored')),
    pending: sumCounts(pending),
    restated: sumCounts(rows.filter((row) => row.state === 'restated')),
    unfilled: sumCounts(rows.filter((row) => row.state === 'unfilled')),
    unresolvable: sumCounts(unresolvable),
  }
}

function sumCounts(rows: readonly SuggestionCoverageRow[]): number {
  return rows.reduce((sum, row) => sum + row.count, 0)
}

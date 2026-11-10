import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { LeanCall, LeanCallOptions } from '@/trading/features/suggestion/store/suggestion-lean'
import type { ScoredPopulation } from '@/trading/features/suggestion/track-record/types'
import { independentCalls } from '@/trading/features/suggestion/pipeline/reporting'

interface PopulationQuery extends LeanCallOptions {
  readonly limit: number
  /** Narrows the whole book before repeats fold and the cut falls. */
  readonly isIncluded?: (call: LeanCall) => boolean
}

interface PopulationDeps {
  readonly store: Pick<SuggestionStore, 'listLeanCalls' | 'listResolved'>
}

/** Folds repeats before it cuts: a book held for weeks re-issues the same idea every session, and
 *  cutting first would spend the limit on copies of one move. Only the survivors' payloads are read. */
export async function readScoredPopulation(
  deps: PopulationDeps,
  query: PopulationQuery
): Promise<ScoredPopulation> {
  const { isIncluded, limit, ...options } = query
  const all = await deps.store.listLeanCalls(options)
  const lean = isIncluded === undefined ? all : all.filter(isIncluded)
  const ids = [...independentCalls(lean)]
    .sort(compareNewestFirst)
    .slice(0, limit)
    .map((call) => call.id)
  const calls = await deps.store.listResolved({
    ids,
    limit: ids.length,
    // A pinned version keeps its own rows; without it the read would drop a call a later version
    // re-ran the same day.
    ...(options.strategyVersion === undefined ? {} : { strategyVersion: options.strategyVersion }),
    signal: options.signal,
  })

  return { calls, lean, earlyCount: 0 }
}

/** The order `listResolved` reads in, so the cut and the page it fetches agree. */
function compareNewestFirst(left: LeanCall, right: LeanCall): number {
  return (
    right.outcome.resolvedAt - left.outcome.resolvedAt ||
    right.outcome.exitDay.localeCompare(left.outcome.exitDay) ||
    right.id.localeCompare(left.id)
  )
}

import type { SuggestionStore } from '@/trading/features/suggestion/store/suggestion'
import type { LeanCall, LeanCallOptions } from '@/trading/features/suggestion/store/suggestion-lean'
import type { ScoredPopulation } from '@/trading/features/suggestion/track-record/types'
import type { MarketRegistry } from '@/trading/markets/types'
import { independentCalls } from '@/trading/features/suggestion/pipeline/reporting'
import { splitByMaturity } from '@/trading/features/suggestion/track-record/maturity'

interface PopulationQuery extends LeanCallOptions {
  readonly limit: number
  /** With `now`, what decides a call's window has passed: only such calls are counted. */
  readonly markets: MarketRegistry
  readonly now: number
  /** Narrows the whole book before repeats fold and the cut falls. */
  readonly isIncluded?: (call: LeanCall) => boolean
}

interface PopulationDeps {
  readonly store: Pick<SuggestionStore, 'listLeanCalls' | 'listResolved'>
}

/** Folds repeats before it cuts: a book held for weeks re-issues the same idea every session, and
 *  cutting first would spend the limit on copies of one move. Only the survivors' payloads are read.
 *  A call joins once its window has passed; `earlyCount` is the independent calls still waiting. */
export async function readScoredPopulation(
  deps: PopulationDeps,
  query: PopulationQuery
): Promise<ScoredPopulation> {
  const { isIncluded, limit, markets, now, ...options } = query
  const all = await deps.store.listLeanCalls(options)
  const included = isIncluded === undefined ? all : all.filter(isIncluded)
  const { mature: lean, early } = splitByMaturity(included, { markets, now })
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

  // Folded over every call, so an early repeat of a mature call is part of that move, not a
  // separate wait: only a chain that starts on an early call is still waiting.
  const waiting = new Set<LeanCall>(early)
  const earlyCount = independentCalls(included).filter((call) => waiting.has(call)).length

  return { calls, lean, earlyCount }
}

/** The order `listResolved` reads in, so the cut and the page it fetches agree. */
function compareNewestFirst(left: LeanCall, right: LeanCall): number {
  return (
    right.outcome.resolvedAt - left.outcome.resolvedAt ||
    compareDescending(left.outcome.exitDay, right.outcome.exitDay) ||
    compareDescending(left.id, right.id)
  )
}

/** Byte order, as the SQL read sorts, where `localeCompare` would reorder by locale. */
function compareDescending(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left < right ? 1 : -1
}

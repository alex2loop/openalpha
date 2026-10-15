import { MS_PER_DAY } from '@/core/utils/time'

import type { ResearchSearchResult } from './retrieval'
import { queryEntityOverlap } from '../query-entities'

// A stale page loses its slot but is never zeroed: the only date available here is the provider's
// estimate, and research rejects on a date only when it verified that date against the page itself.
const STALE_GRACE_DAYS = 14
const STALE_DECAY_DAYS = 365
const STALE_FLOOR = 0.5

interface ScoredResult {
  readonly result: ResearchSearchResult
  readonly index: number
  readonly score: number
}

interface RankSearchResultsInput {
  readonly results: readonly ResearchSearchResult[]
  readonly entities: readonly string[]
  /** The run's clock, read once at the top of the run and threaded down. */
  readonly now: number
  /** Staleness ranks only when a freshness window was asked for. */
  readonly applyStaleness: boolean
}

/**
 * Orders candidates by what a title and a snippet can tell us, before a fetch is paid for. With no
 * entities and no freshness window every score is zero and the stable sort returns provider order,
 * so the ranking can never do worse than the arrival sequence it replaces.
 */
export function rankSearchResults(input: RankSearchResultsInput): readonly ResearchSearchResult[] {
  return input.results
    .map((result, index): ScoredResult => ({ result, index, score: scoreResult(result, input) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((scored) => scored.result)
}

function scoreResult(result: ResearchSearchResult, input: RankSearchResultsInput): number {
  const overlap = queryEntityOverlap(input.entities, `${result.title}\n${result.snippet}`)
  return input.applyStaleness ? overlap * stalenessFactor(result.publishedOn, input.now) : overlap
}

function stalenessFactor(publishedOn: string | undefined, now: number): number {
  if (publishedOn === undefined) {
    return 1
  }

  const published = Date.parse(publishedOn)
  if (Number.isNaN(published)) {
    return 1
  }

  const ageDays = Math.max(0, now - published) / MS_PER_DAY
  if (ageDays <= STALE_GRACE_DAYS) {
    return 1
  }

  const decay = Math.exp(-(ageDays - STALE_GRACE_DAYS) / STALE_DECAY_DAYS)
  return STALE_FLOOR + (1 - STALE_FLOOR) * decay
}

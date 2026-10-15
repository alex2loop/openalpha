import type { ResolvedConfig, ResolvedSearchProvider } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { ResearchSearchInput } from '@/engine/api'

import type { Recency, SearchRequest } from './search/types'

const SEARCH_RESULT_MAX = 20

type RetrievalSearchInput = ResearchSearchInput & {
  readonly recency?: Recency
  readonly safeSearch?: 0 | 1 | 2
}

export function defaultSearchProvider(config: ResolvedConfig): ResolvedSearchProvider {
  return config.webSearch
}

export function toSearchRequest(
  input: RetrievalSearchInput,
  config: ResolvedConfig,
  logger: Logger
): Omit<SearchRequest, 'apiKey' | 'baseUrl' | 'signal'> {
  return {
    query: input.query,
    maxResults: hasFilters(input) ? SEARCH_RESULT_MAX : input.maxResults,
    language: input.locale,
    logger,
    snippetMaxChars: config.webSearch.snippetMaxChars,
    exaSearchType: config.webSearch.exaSearchType,
    ...(input.recency === undefined ? {} : { recency: input.recency }),
    ...(input.freshness === undefined ? {} : { freshness: input.freshness }),
    ...(input.safeSearch === undefined ? {} : { safeSearch: input.safeSearch }),
    ...(input.includeDomains === undefined ? {} : { includeDomains: input.includeDomains }),
    ...(input.excludeDomains === undefined ? {} : { excludeDomains: input.excludeDomains }),
  }
}

function hasFilters(input: {
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
}): boolean {
  return input.includeDomains !== undefined || input.excludeDomains !== undefined
}

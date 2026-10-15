import type { ExaSearchType, WebSearchProvider } from '@/core/config/resolve'
import type { RunId, SessionId } from '@/core/ids'
import type { Locale } from '@/core/types/locale'
import type { ExternalCharge } from '@/core/types/usage'

import type { ProviderHighlight, ResearchFreshness } from '../evidence/model'

export interface ResearchRetrievalCall {
  readonly signal: AbortSignal
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly cacheScope?: SessionId | RunId
}

export interface ResearchSearchInput extends ResearchRetrievalCall {
  readonly query: string
  readonly maxResults: number
  readonly locale: Locale
  readonly freshness?: ResearchFreshness
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
}

export interface ResearchContentsInput extends ResearchRetrievalCall {
  readonly role: 'default' | 'fallback'
  readonly urls: readonly string[]
  readonly query: string
}

export interface ResearchDirectFetchInput extends ResearchRetrievalCall {
  readonly url: string
  /** Reads the published day from the page's raw markup, before it is converted to text. */
  readonly publishedDayOf: (markup: string) => string | undefined
}

export interface ResearchSearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly author?: string
  readonly publishedOn?: string
  readonly highlights: readonly ProviderHighlight[]
  readonly engines: readonly string[]
}

export interface ResearchContentsItem {
  readonly canonicalUrl: string
  readonly retrievedAt: number
  readonly text: string
}

export interface ResearchContentsFailure {
  readonly canonicalUrl: string
  readonly errorTag: string
  readonly httpStatus?: number
}

export type ResearchProviderFailureCode =
  | 'authentication'
  | 'invalid_request'
  | 'rate_limited'
  | 'timeout'
  | 'transport'
  | 'invalid_response'
  | 'content_unavailable'
  | 'content_limit'
  | 'unsupported_filter'
  | 'circuit_open'

export interface ResearchProviderAttempt {
  readonly transport: 'provider'
  readonly provider: WebSearchProvider
  readonly role: 'default' | 'fallback'
  readonly operation: 'search' | 'contents'
  readonly outcome: 'success' | 'empty' | 'partial' | 'failed' | 'cache_hit'
  readonly latencyMs: number
  readonly costUsd: number
  readonly resultCount: number
  readonly freshness: 'not_requested' | 'pushed_down' | 'post_filtered' | 'unverified'
  readonly requestId?: string
  readonly requestedSearchType?: ExaSearchType
  readonly resolvedSearchType?: string
  readonly failureCode?: ResearchProviderFailureCode
}

export type ResearchSearchOutcome =
  | {
      readonly kind: 'results'
      readonly results: readonly ResearchSearchResult[]
      readonly attempt: ResearchProviderAttempt
    }
  | { readonly kind: 'empty'; readonly attempt: ResearchProviderAttempt }
  | { readonly kind: 'failed'; readonly attempt: ResearchProviderAttempt }
  | { readonly kind: 'fallback_unconfigured' }

export type ResearchContentsOutcome =
  | {
      readonly kind: 'contents'
      readonly items: readonly ResearchContentsItem[]
      readonly failures: readonly ResearchContentsFailure[]
      readonly attempt: ResearchProviderAttempt
    }
  | { readonly kind: 'failed'; readonly attempt: ResearchProviderAttempt }
  | { readonly kind: 'provider_unavailable' }

export interface ResearchDirectFetchAttempt {
  readonly transport: 'direct'
  readonly operation: 'fetch'
  readonly canonicalUrl: string
  readonly outcome: 'success' | 'failed' | 'cache_hit'
  readonly latencyMs: number
  readonly costUsd: number
  readonly failureCode?: ResearchProviderFailureCode
}

export type ResearchDirectFetchOutcome =
  | {
      readonly kind: 'content'
      readonly canonicalUrl: string
      readonly retrievedAt: number
      readonly text: string
      readonly publishedDay?: string
      readonly attempt: ResearchDirectFetchAttempt
    }
  | { readonly kind: 'failed'; readonly attempt: ResearchDirectFetchAttempt }

export interface ResearchRetrieval {
  searchDefault(input: ResearchSearchInput): Promise<ResearchSearchOutcome>
  searchFallback(input: ResearchSearchInput): Promise<ResearchSearchOutcome>
  retrieveContents(input: ResearchContentsInput): Promise<ResearchContentsOutcome>
  fetchDirect(input: ResearchDirectFetchInput): Promise<ResearchDirectFetchOutcome>
}

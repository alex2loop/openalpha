import type {
  ExaSearchType,
  ResolvedSearchProvider,
  ResolvedWebSearch,
} from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { DnsLookupFn } from '@/core/ssrf/network-policy'
import type { Locale } from '@/core/types/locale'
import type { ExternalCharge } from '@/core/types/usage'
import type { TtlCache } from '@/core/utils/collections'
import type {
  ProviderHighlight,
  ResearchContentsFailure,
  ResearchContentsItem,
  ResearchFreshness,
  ResearchProviderAttempt,
} from '@/engine/api'
import type { ProviderBreaker } from '@/tools/web/search/provider-breaker'

export const ZERO_PROVIDER_COST_USD = 0

export type SearchOperation = 'search' | 'contents'

export type Recency = 'day' | 'week' | 'month' | 'year'

export interface SearchResult {
  readonly title: string
  readonly url: string
  readonly snippet: string
  readonly author?: string
  readonly publishedOn?: string
  readonly highlights: readonly ProviderHighlight[]
  readonly engines: readonly string[]
}

export interface SearchRequest {
  readonly query: string
  readonly maxResults: number
  readonly language: Locale
  readonly logger: Logger
  readonly recency?: Recency
  readonly freshness?: ResearchFreshness
  readonly safeSearch?: 0 | 1 | 2
  readonly signal: AbortSignal
  readonly apiKey?: string
  readonly baseUrl?: string
  readonly dnsLookup?: DnsLookupFn
  readonly includeDomains?: readonly string[]
  readonly excludeDomains?: readonly string[]
  /**
   * Per-result snippet character cap (config-derived). Backends that build snippets should trim to
   * this bound; the retrieval service enforces it as a final safety net.
   */
  readonly snippetMaxChars?: number
  /**
   * Exa Search `type`. Read by the Exa backend only; other backends ignore it.
   */
  readonly exaSearchType?: ExaSearchType
}

export interface SearchBackendResponse {
  readonly results: readonly SearchResult[]
  readonly costUsd: number
  readonly freshness: 'not_requested' | 'pushed_down' | 'post_filtered' | 'unverified'
  readonly requestId?: string
  readonly requestedSearchType?: ExaSearchType
  readonly resolvedSearchType?: string
}

export type SearchBackend = (request: SearchRequest) => Promise<SearchBackendResponse>

export interface ExaContentsResponse {
  readonly items: readonly ResearchContentsItem[]
  readonly failures: readonly ResearchContentsFailure[]
  readonly costUsd: number
  readonly requestId: string
}

// Mutable by design: the runner mutates one gate per provider in place to track live concurrency.
export interface ProviderGate {
  active: number
  starting: boolean
  lastStartedAt?: number
  /** FIFO queue of callers waiting for a turn; woken in arrival order as capacity frees up. */
  waiters: Array<() => void>
}

interface CachedDirectContent {
  readonly canonicalUrl: string
  readonly retrievedAt: number
  readonly text: string
  readonly publishedDay?: string
}

export type RetrievalCacheEntry =
  | { readonly kind: 'search'; readonly response: SearchBackendResponse }
  | { readonly kind: 'contents'; readonly response: ExaContentsResponse }
  | { readonly kind: 'direct'; readonly content: CachedDirectContent }

export interface ProviderSearchRunInput {
  readonly backend: SearchBackend
  readonly configured: ResolvedSearchProvider
  readonly role: 'default' | 'fallback'
  readonly request: Omit<SearchRequest, 'apiKey' | 'baseUrl' | 'signal'>
  readonly signal: AbortSignal
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly cacheScope?: string
  readonly requestedMaxResults: number
}

export type ProviderSearchRunResult =
  | {
      readonly kind: 'response'
      readonly response: SearchBackendResponse
      readonly attempt: ResearchProviderAttempt
    }
  | { readonly kind: 'failed'; readonly attempt: ResearchProviderAttempt }

export interface ProviderContentsRunInput {
  readonly configured: ResolvedSearchProvider
  readonly role: 'default' | 'fallback'
  readonly urls: readonly string[]
  readonly query: string
  readonly signal: AbortSignal
  readonly recordExternalCost: (charge: ExternalCharge) => Promise<void>
  readonly cacheScope?: string
  readonly execute: (signal: AbortSignal) => Promise<ExaContentsResponse>
}

export type ProviderContentsRunResult =
  | {
      readonly kind: 'response'
      readonly response: ExaContentsResponse
      readonly attempt: ResearchProviderAttempt
    }
  | { readonly kind: 'failed'; readonly attempt: ResearchProviderAttempt }

export interface ProviderRunner {
  search(input: ProviderSearchRunInput): Promise<ProviderSearchRunResult>
  contents(input: ProviderContentsRunInput): Promise<ProviderContentsRunResult>
  readDirect(key: string): CachedDirectContent | undefined
  writeDirect(key: string, content: CachedDirectContent): void
}

export interface ProviderRunnerState {
  readonly config: ResolvedWebSearch
  readonly cache: TtlCache<string, RetrievalCacheEntry> | undefined
  readonly gates: Map<string, ProviderGate>
  readonly breaker: ProviderBreaker
}

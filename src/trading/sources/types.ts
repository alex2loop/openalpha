import type { CaveatCode } from '@/trading/kernel/caveat'
import type { SourceId } from '@/trading/kernel/source/source-id'
import type { SourceSummary } from '@/trading/kernel/source/source-result'

export interface SourceRequest {
  readonly sourceId: SourceId
  /** Provider-relative. Never an absolute URL — the host comes from the boot-validated endpoint. */
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly headers?: Readonly<Record<string, string>>
  /** Declares placement only. `SourceHttp` reads and injects the resolved raw secret; `optional`
   *  sends the request without one where a provider serves a keyless tier. */
  readonly credential?:
    | {
        readonly kind: 'header'
        readonly name: string
        readonly prefix?: string
        readonly optional?: true
      }
    | { readonly kind: 'query'; readonly name: string; readonly optional?: true }
  /** Allowlisted feed id (RSS). When set, host and path come from the code-owned feed map and
   *  `path`/`query` are ignored; a feed outside the allowlist is never fetched. */
  readonly feedId?: string
  /** Set by `postJson` callers only: its presence turns the request into a POST carrying this
   *  object as the body. Reserved for providers with no GET equivalent, and only ever for a read -
   *  the retry policy replays the request, so a body that mutates anything would replay too. */
  readonly jsonBody?: Readonly<Record<string, unknown>>
  /** Provider-specific non-retryable statuses that mean this request is unsupported, not outage. */
  readonly businessMissStatuses?: readonly number[]
  /** Per-request attempt deadline. Quote-class reads declare a tight SLA instead of inheriting
   *  the bulk-sweep default; absent means ATTEMPT_TIMEOUT_MS. */
  readonly attemptTimeoutMs?: number
  /** Per-request retry cap; absent means RETRY_MAXIMUM_ATTEMPTS. */
  readonly maxAttempts?: number
  /** Per-request response cap, only ever below MAXIMUM_RESPONSE_BYTES. */
  readonly maxBytes?: number
  readonly signal: AbortSignal
}

export type SourceFetchOutcome<T> =
  // truncated is set only when getJsonPages hit MAXIMUM_PAGES with the last page still full.
  | {
      readonly kind: 'ok'
      readonly value: T
      readonly fetchedAt: number
      readonly truncated?: boolean
    }
  | { readonly kind: 'error'; readonly code: CaveatCode }

export interface PagedSourceRequest extends SourceRequest {
  readonly pageSize: number
  readonly pageParam?: string
}

export interface SourceHttp {
  getJson<T>(
    request: SourceRequest,
    parse: (raw: unknown, fetchedAt: number) => T
  ): Promise<SourceFetchOutcome<T>>
  postJson<T>(
    request: SourceRequest,
    parse: (raw: unknown, fetchedAt: number) => T
  ): Promise<SourceFetchOutcome<T>>
  getText(request: SourceRequest): Promise<SourceFetchOutcome<string>>
  /** Fetches follow-up pages while a page returns exactly `pageSize` rows, up to MAXIMUM_PAGES,
   *  concatenating `extractRows`'s output, so no adapter writes its own page loop. */
  getJsonPages<TRow>(
    request: PagedSourceRequest,
    extractRows: (raw: unknown) => readonly TRow[]
  ): Promise<SourceFetchOutcome<readonly TRow[]>>
  summary(sourceId: SourceId): Omit<SourceSummary, 'kind'>
}

/** Everything the transport needs to reach a provider, all of it code-owned. Assembled once by
 *  the source registry so no adapter and no config can redirect a request at another host. */
export interface SourceFacts {
  /** One origin, or a list for transport failover across the same backend. */
  readonly endpoints: Readonly<Partial<Record<SourceId, string | readonly string[]>>>
  readonly rateLimits: Readonly<Partial<Record<SourceId, number>>>
  /** Keyed by the feed id an adapter names — the market ref, for RSS. */
  readonly feeds: Readonly<Record<string, string>>
  /** Resolved from the environment at composition; the raw secret never enters a config object. */
  readonly credentials: Readonly<Partial<Record<SourceId, string>>>
  /** Providers served the plain agent string because they refuse a browser one. */
  readonly plainUserAgentSources: ReadonlySet<SourceId>
}

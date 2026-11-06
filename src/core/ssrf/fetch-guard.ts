import type { DnsLookupFn } from '@/core/ssrf/dns'

/** A guarded request constructs its own `Response`, whose `url` may be empty, hence `finalUrl`. */
export interface GuardedResponse {
  readonly response: Response
  readonly finalUrl: string
}

export interface GuardedFetchOptions {
  readonly allowlist?: readonly string[]
  readonly dnsLookup?: DnsLookupFn
}

/** How a user-supplied URL is fetched. The daemon vets and pins every hop (`NetworkPolicy`); a page
 *  has only its own `fetch`, so the browser binds its own. A tool that reads a page asks for this,
 *  never for either implementation. */
export interface FetchGuard {
  guardedFetch(
    url: string,
    init: RequestInit,
    options?: GuardedFetchOptions
  ): Promise<GuardedResponse>
  /** A local endpoint the operator runs; a page never has one. */
  guardedLoopbackFetch(url: string, init: RequestInit): Promise<Response>
}

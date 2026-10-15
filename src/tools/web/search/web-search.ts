import { z } from 'zod'

import type { DisplayText } from '@/core/stream-events'
import type { SearchResult } from '@/tools/web/search/types'
import { createTool } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'
import { toSummaryJson } from '@/tools/summary'

const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i
const SEARCH_RESULT_MAX = 20
const SEARCH_RESULT_DEFAULT = 5
const SEARCH_QUERY_MAX_CHARS = 500
const SEARCH_DOMAIN_FILTER_MAX = 20
// The search backends carry no per-request cap of their own; without this only the run-level
// deadline bounds a hung provider.
const WEB_SEARCH_TIMEOUT_MS = 30_000

const outputSchema = z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string() }))

const inputSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(SEARCH_QUERY_MAX_CHARS)
    .describe(
      'Keyword query, 2 to 8 words. Add site:domain to restrict an official-source search.'
    ),
  max_results: z.coerce
    .number()
    .int()
    .min(1)
    .max(SEARCH_RESULT_MAX)
    .default(SEARCH_RESULT_DEFAULT)
    .describe(`Results to return, 1 to ${SEARCH_RESULT_MAX}.`),
  recency: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Only results published within this window. Omit for no time filter.'),
  include_domains: z
    .array(z.string().regex(DOMAIN_RE, 'must be a bare domain'))
    .max(SEARCH_DOMAIN_FILTER_MAX)
    .optional()
    .describe('Bare domains to search within, such as "sec.gov". Omit to search the open web.'),
  exclude_domains: z
    .array(z.string().regex(DOMAIN_RE, 'must be a bare domain'))
    .max(SEARCH_DOMAIN_FILTER_MAX)
    .optional()
    .describe('Bare domains to drop from the results. Omit unless a source is known to be noise.'),
})

export const webSearchTool = createTool({
  name: 'web_search',
  description:
    'Query the web for current results by keyword — pages, news, and official documentation. Returns a normalized JSON array of `{title, url, snippet}` snippets; use `web_fetch` to read a result page for detail. An error or empty result uses the configured fallback, or the keyless default when none is configured.',
  inputSchema,
  capability: 'net',
  eager: true,
  timeoutMs: WEB_SEARCH_TIMEOUT_MS,
  outputSchema,
  presentation: { label: 'Web search', emoji: '🔍', detailKeys: ['query'] },
  summarizeResult: summarizeWebSearch,
  async execute(args, ctx): Promise<string> {
    const results = await ctx.services.webRetrieval.searchGeneral({
      query: args.query,
      maxResults: args.max_results,
      locale: ctx.locale,
      signal: ctx.signal,
      recordExternalCost: ctx.recordExternalCost,
      cacheScope: ctx.sessionId,
      ...(args.recency === undefined ? {} : { recency: args.recency }),
      ...(ctx.config.webSearch.safeSearch === undefined
        ? {}
        : { safeSearch: ctx.config.webSearch.safeSearch }),
      ...(args.include_domains === undefined
        ? {}
        : { includeDomains: canonicalDomains(args.include_domains) }),
      ...(args.exclude_domains === undefined
        ? {}
        : { excludeDomains: canonicalDomains(args.exclude_domains) }),
    })

    return JSON.stringify(results.map(toGeneralSearchView))
  },
})

function canonicalDomains(domains: readonly string[]): readonly string[] {
  return [...new Set(domains.map((domain) => domain.toLocaleLowerCase()))]
}

function toGeneralSearchView(result: SearchResult): {
  readonly title: string
  readonly url: string
  readonly snippet: string
} {
  return { title: result.title, url: result.url, snippet: result.snippet }
}

function summarizeWebSearch(content: string): DisplayText | undefined {
  const parsed = toSummaryJson(content)

  if (Array.isArray(parsed)) {
    return resultCount(parsed.length)
  }

  if (isPlainRecord(parsed) && Array.isArray(parsed.rows)) {
    return resultCount(parsed.rows.length)
  }

  return undefined
}

function resultCount(count: number): DisplayText {
  return {
    key: count === 1 ? 'toolSummaries.webSearchResult' : 'toolSummaries.webSearchResults',
    params: { count },
  }
}

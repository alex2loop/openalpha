import type { ResolvedWebSearch, WebSearchProvider } from '@/core/config/resolve'
import { hostOfUrl } from '@/core/utils/url'
import { ANYSEARCH_ENDPOINT } from '@/tools/web/search/backends/anysearch'
import { BRAVE_ENDPOINT } from '@/tools/web/search/backends/brave'
import { DEEPSEEK_ENDPOINT } from '@/tools/web/search/backends/deepseek'
import { DUCKDUCKGO_HOST } from '@/tools/web/search/backends/duckduckgo'
import { EXA_API_ORIGIN } from '@/tools/web/search/backends/exa-protocol'
import { SERPER_ENDPOINT } from '@/tools/web/search/backends/serper'
import { TAVILY_ENDPOINT } from '@/tools/web/search/backends/tavily'

/** Where each hosted backend sends a query. SearXNG is the operator's own instance, named by
 *  `base_url`, so it has no entry here. */
const SEARCH_ENDPOINTS = {
  anysearch: ANYSEARCH_ENDPOINT,
  brave: BRAVE_ENDPOINT,
  deepseek: DEEPSEEK_ENDPOINT,
  duckduckgo: DUCKDUCKGO_HOST,
  exa: EXA_API_ORIGIN,
  serper: SERPER_ENDPOINT,
  tavily: TAVILY_ENDPOINT,
} as const satisfies Readonly<Record<Exclude<WebSearchProvider, 'searxng'>, string>>

interface SearchBackendChoice {
  readonly provider: WebSearchProvider
  readonly baseUrl?: string
}

/** The hosts a search term can go to under this config: the primary backend, unless its key is
 *  missing and search is off, and the fallback. */
export function listSearchHosts(search: ResolvedWebSearch): readonly string[] {
  const primary = search.missingEnv === undefined ? [search] : []
  const fallback = search.fallback === undefined ? [] : [search.fallback]

  return [...primary, ...fallback].flatMap((choice) => hostOf(choice))
}

function hostOf(choice: SearchBackendChoice): readonly string[] {
  const url = choice.provider === 'searxng' ? choice.baseUrl : SEARCH_ENDPOINTS[choice.provider]
  const host = url === undefined ? undefined : hostOfUrl(url)

  return host === undefined ? [] : [host]
}

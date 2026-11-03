import { findProviderById } from '@/ai/api'
import { BROWSER_AI_PROVIDERS, BROWSER_SEARCH_PROVIDERS } from '@/app/browser/keys'
import { hostOfUrl } from '@/core/utils/url'
import { listSearchProviderHosts } from '@/tools/api'
import { listBrowserSourceHosts } from '@/trading/api'

/** Every host the worker may send a request to: the sources a browser answers, the AI providers a
 *  visitor's key works with and the search backends. Read from the tables the requests are built
 *  from, so the page's content security policy cannot name a host the code never calls, or miss
 *  one it does. */
export function listBrowserHosts(): readonly string[] {
  const ai = BROWSER_AI_PROVIDERS.flatMap((id) => {
    const baseUrl = findProviderById(id)?.baseUrl

    return baseUrl === undefined ? [] : (hostOfUrl(baseUrl) ?? [])
  })
  const hosts = [
    ...listBrowserSourceHosts(),
    ...ai,
    ...listSearchProviderHosts(BROWSER_SEARCH_PROVIDERS),
  ]

  return [...new Set(hosts)].toSorted()
}

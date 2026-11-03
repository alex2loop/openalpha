import type { BrowserKeyring } from '@/app/browser/keys'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { FetchGuard } from '@/core/ssrf/fetch-guard'
import type { WebRetrievalService } from '@/tools/api'
import { resolveBrowserSearch } from '@/app/browser/config'
import { readSearchSelection } from '@/app/browser/keys'
import { createWebRetrievalService } from '@/tools/api'

interface RetrievalParts {
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly guard: FetchGuard
  readonly keyring: BrowserKeyring
}

/** The service reads its search key when built, so it is rebuilt whenever the keyring holds another
 *  one; every call goes to the current service. */
export function createBrowserRetrieval(parts: RetrievalParts): WebRetrievalService {
  let built: { readonly fingerprint: string; readonly service: WebRetrievalService } | undefined

  const current = (): WebRetrievalService => {
    const env = parts.keyring.env()
    const selected = readSearchSelection(env)
    const fingerprint =
      selected === undefined ? '' : `${selected.provider}:${env[selected.variable]}`

    if (built?.fingerprint !== fingerprint) {
      built = {
        fingerprint,
        service: createWebRetrievalService(
          { ...parts.config, webSearch: resolveBrowserSearch(env) },
          parts.logger,
          parts.guard
        ),
      }
    }

    return built.service
  }

  return {
    searchDefault: (input) => current().searchDefault(input),
    searchFallback: (input) => current().searchFallback(input),
    retrieveContents: (input) => current().retrieveContents(input),
    fetchDirect: (input) => current().fetchDirect(input),
    searchGeneral: (input) => current().searchGeneral(input),
    fetchGeneral: (input) => current().fetchGeneral(input),
  }
}

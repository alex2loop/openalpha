import type { BrowserKeyring } from '@/app/browser/keys'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Logger } from '@/core/logging/logger'
import type { FetchGuard } from '@/core/ssrf/fetch-guard'
import type {
  ResearchDirectFetchInput,
  ResearchDirectFetchOutcome,
  ResearchSearchOutcome,
} from '@/engine/api'
import type { WebRetrievalService } from '@/tools/api'
import { resolveBrowserSearch } from '@/app/browser/config'
import { readSearchSelection } from '@/app/browser/keys'
import { type LruMap, lruMap } from '@/core/utils/collections'
import { createWebRetrievalService } from '@/tools/api'

/** How many search results keep their text for the page read that asks for them. */
const HELD_RESULTS = 256
const TEXT_SEPARATOR = '\n\n'

interface RetrievalParts {
  readonly config: ResolvedConfig
  readonly logger: Logger
  readonly guard: FetchGuard
  readonly keyring: BrowserKeyring
}

/** The service reads its search key when built, so it is rebuilt whenever the keyring holds another
 *  one; every call goes to the current service. A page cannot read another site's result page, so
 *  reading one returns what the search provider sent for it: a page read must never end with no text
 *  because the browser refused the request. */
export function createBrowserRetrieval(parts: RetrievalParts): WebRetrievalService {
  const sent = lruMap<string, string>(HELD_RESULTS)
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
    searchDefault: async (input) => holdResults(sent, await current().searchDefault(input)),
    searchFallback: async (input) => holdResults(sent, await current().searchFallback(input)),
    retrieveContents: (input) => current().retrieveContents(input),
    fetchDirect: async (input) => {
      const text = sent.get(keyOf(input.url) ?? '')

      return text === undefined ? await current().fetchDirect(input) : toContent(input, text)
    },
    searchGeneral: (input) => current().searchGeneral(input),
    fetchGeneral: (input) => current().fetchGeneral(input),
  }
}

/** Keeps the text of each result the provider sent, so the read of that page can answer with it. */
function holdResults(
  sent: LruMap<string, string>,
  outcome: ResearchSearchOutcome
): ResearchSearchOutcome {
  if (outcome.kind !== 'results') {
    return outcome
  }

  for (const result of outcome.results) {
    const key = keyOf(result.url)
    const text = [...new Set([result.snippet, ...result.highlights.map((item) => item.text)])]
      .filter((part) => part !== '')
      .join(TEXT_SEPARATOR)

    if (key !== undefined && text !== '') {
      sent.set(key, text)
    }
  }

  return outcome
}

/** An address as the engine asks for it: https, no fragment. */
function keyOf(url: string): string | undefined {
  try {
    const parsed = new URL(url)

    parsed.protocol = 'https:'
    parsed.hash = ''

    return parsed.href
  } catch {
    // Not an address: nothing was kept for it.
    return undefined
  }
}

function toContent(
  input: ResearchDirectFetchInput,
  text: string
): Extract<ResearchDirectFetchOutcome, { readonly kind: 'content' }> {
  const canonicalUrl = keyOf(input.url) ?? input.url

  return {
    kind: 'content',
    canonicalUrl,
    retrievedAt: Date.now(),
    text,
    attempt: {
      transport: 'direct',
      operation: 'fetch',
      canonicalUrl,
      outcome: 'cache_hit',
      latencyMs: 0,
      costUsd: 0,
    },
  }
}

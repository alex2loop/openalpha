import type { BrowserKeyring } from '@/app/browser/keys'
import type { Locale } from '@/core/types/locale'
import type { ResearchCoordinator } from '@/engine/api'
import { hasSearchKey, listSearchProviderNames } from '@/app/browser/keys'
import { RESEARCH_PROFILE_DEPTHS } from '@/core/config/resolve'
import { bindLocale } from '@/i18n'

const PROVIDER_SEPARATOR = ', '

/** The reply for research no search key could serve: it names the providers a visitor may add a
 *  key for. A page cannot reach the keyless backend the config falls back to, so without a key
 *  every search would come back empty after the model had already planned the run. */
export function renderSearchKeyNeeded(locale: Locale): string {
  return bindLocale(locale).translate('errors.browserResearchNeedsSearchKey', {
    providers: listSearchProviderNames().join(PROVIDER_SEPARATOR),
  })
}

/** Research that a model-called `research` tool starts: with no search key it fails at once with
 *  that reason, before any model call, instead of searching a backend the page cannot reach. */
export function gateResearch(
  coordinator: ResearchCoordinator,
  keyring: BrowserKeyring
): ResearchCoordinator {
  return {
    run: async (request, invocation) => {
      if (hasSearchKey(keyring.env())) {
        return await coordinator.run(request, invocation)
      }

      return {
        status: 'failed',
        depth: request.depth ?? RESEARCH_PROFILE_DEPTHS.standard,
        code: 'provider_unavailable',
        message: renderSearchKeyNeeded(invocation.locale),
        failures: [],
      }
    },
  }
}

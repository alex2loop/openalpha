import type { BrowserKeyring } from '@/app/browser/keys'
import type { BrowserAiProvider } from '@/app/server/wire/worker'
import type { ResolvedConfig } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import type { ResearchCoordinator } from '@/engine/api'
import {
  findMissingKeyProvider,
  hasSearchKey,
  listSearchProviderNames,
  renderProviderName,
} from '@/app/browser/keys'
import { RESEARCH_PROFILE_DEPTHS } from '@/core/config/resolve'
import { RESEARCH_HEAVY_MODEL_TIER, RESEARCH_MODEL_TIER } from '@/engine/api'
import { bindLocale } from '@/i18n'

const PROVIDER_SEPARATOR = ', '
const RESEARCH_MODEL_TIERS = [RESEARCH_MODEL_TIER, RESEARCH_HEAVY_MODEL_TIER] as const

/** The reply for a model call no key in its chain could serve, naming the provider to add one for. */
export function renderModelKeyNeeded(locale: Locale, provider: BrowserAiProvider): string {
  return bindLocale(locale).translate('errors.browserChatNeedsKey', {
    provider: renderProviderName(locale, provider),
  })
}

/** Why research cannot run on the page's keys, or undefined when it can: a research tier no key
 *  serves would fail mid-run, and with no search key every search would come back empty, since a
 *  page cannot reach the keyless backend the config falls back to. */
export function researchRefusalOf(
  keyring: BrowserKeyring,
  config: Pick<ResolvedConfig, 'models' | 'modelTiers'>,
  locale: Locale
): string | undefined {
  const env = keyring.env()
  const missing = findMissingKeyProvider(env, config, RESEARCH_MODEL_TIERS)

  if (missing !== undefined) {
    return renderModelKeyNeeded(locale, missing)
  }

  return hasSearchKey(env)
    ? undefined
    : bindLocale(locale).translate('errors.browserResearchNeedsSearchKey', {
        providers: listSearchProviderNames(locale).join(PROVIDER_SEPARATOR),
      })
}

/** Research that a model-called `research` tool starts meets the same rule as `/research`: it fails
 *  at once with the reason, before any model call. */
export function gateResearch(
  coordinator: ResearchCoordinator,
  keyring: BrowserKeyring,
  config: Pick<ResolvedConfig, 'models' | 'modelTiers'>
): ResearchCoordinator {
  return {
    run: async (request, invocation) => {
      const refusal = researchRefusalOf(keyring, config, invocation.locale)

      if (refusal === undefined) {
        return await coordinator.run(request, invocation)
      }

      return {
        status: 'failed',
        depth: request.depth ?? RESEARCH_PROFILE_DEPTHS.standard,
        code: 'provider_unavailable',
        message: refusal,
        failures: [],
      }
    },
  }
}

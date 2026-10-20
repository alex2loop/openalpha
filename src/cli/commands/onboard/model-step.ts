import type { ProviderEntry } from '@/ai/api'
import type { Locale } from '@/core/types/locale'
import {
  CATALOG_MODELS,
  CHATGPT_PROVIDER_ID,
  findProviderById,
  PROVIDERS,
  providerById,
  requiresApiKey,
} from '@/ai/api'
import { getEnv } from '@/cli/env'
import { hint, warn } from '@/cli/ui/colors'
import { isEnvName } from '@/core/config/resolve'
import { closestName } from '@/core/utils/text'
import { t } from '@/i18n'

import type { StarterModel } from './config-file'
import {
  type AskContext,
  accept,
  askChoice,
  askUntilValid,
  indexOrLast,
  type Parsed,
  refuse,
} from './ask'

// The short list a newcomer picks from; every other provider is one typed id away.
const FEATURED_PROVIDERS = [
  'openrouter',
  'anthropic',
  'openai',
  CHATGPT_PROVIDER_ID,
  'gemini',
  'deepseek',
  'ollama',
] as const
const WEB_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

export interface ModelAnswer {
  readonly provider: ProviderEntry
  readonly starter: StarterModel
}

/** The model, endpoint and key variable for a picked provider; a previous answer for the same
 *  provider is the marked default. */
export async function askModelFor(
  ctx: AskContext,
  provider: ProviderEntry,
  previous?: ModelAnswer
): Promise<ModelAnswer> {
  const model = await askModelName(
    ctx,
    provider,
    previous?.provider.id === provider.id ? previous.starter.model : undefined
  )
  const baseUrl = provider.baseUrl === '' ? await askBaseUrl(ctx) : undefined
  const apiKeyEnv = await askKeyEnv(ctx, provider, baseUrl ?? provider.baseUrl)

  return {
    provider,
    starter: {
      provider: provider.id,
      model,
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    },
  }
}

export async function askProvider(
  ctx: AskContext,
  previous?: ProviderEntry
): Promise<ProviderEntry> {
  const featured = FEATURED_PROVIDERS.map(providerById)
  const keyed = featured.findIndex((provider) => isEnvSet(provider.apiKeyEnv))
  const listed = featured.findIndex((provider) => provider.id === previous?.id)

  ctx.app.out(t(ctx.locale, 'cli.onboardProviderIntro'))

  const picked = await askChoice<ProviderEntry | undefined>(ctx, {
    question: t(ctx.locale, 'cli.onboardPromptProvider'),
    choices: [
      ...featured.map((provider) => ({
        label: provider.displayName,
        value: provider,
        ...noteOf(provider, ctx.locale),
      })),
      { label: t(ctx.locale, 'cli.onboardOtherProvider'), value: undefined },
    ],
    defaultIndex: previous === undefined ? Math.max(keyed, 0) : indexOrLast(listed, featured),
  })

  return picked ?? (await askOtherProvider(ctx))
}

async function askOtherProvider(ctx: AskContext): Promise<ProviderEntry> {
  const ids = PROVIDERS.map((provider) => provider.id).sort()

  ctx.app.out(hint(t(ctx.locale, 'cli.onboardAllProviders', { providers: ids.join(', ') })))

  return await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptProviderId'), (answer) =>
    parseProviderId(answer, ctx.locale)
  )
}

function parseProviderId(answer: string, locale: Locale): Parsed<ProviderEntry> {
  const provider = findProviderById(answer)

  if (provider !== undefined) {
    return accept(provider)
  }

  const near = closestName(
    answer,
    PROVIDERS.map((entry) => entry.id)
  )

  return refuse(
    near === undefined
      ? t(locale, 'cli.onboardProviderUnknown', { provider: answer })
      : t(locale, 'cli.onboardProviderUnknownNear', { provider: answer, near })
  )
}

async function askModelName(
  ctx: AskContext,
  provider: ProviderEntry,
  previous?: string
): Promise<string> {
  const known = knownModels(provider)

  if (known.length === 0) {
    return await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptModelName'), (answer) =>
      answer === '' ? refuse(t(ctx.locale, 'cli.onboardModelRequired')) : accept(answer)
    )
  }

  ctx.app.out(t(ctx.locale, 'cli.onboardModelIntro', { provider: provider.displayName }))

  const picked = await askChoice<string | undefined>(ctx, {
    question: t(ctx.locale, 'cli.onboardPromptModel'),
    choices: [
      ...known.map((model) => ({ label: model, value: model })),
      { label: t(ctx.locale, 'cli.onboardModelOther'), value: undefined },
    ],
    defaultIndex: previous === undefined ? 0 : indexOrLast(known.indexOf(previous), known),
  })

  return (
    picked ??
    (await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptModelName'), (answer) =>
      acceptUnlisted(ctx, answer)
    ))
  )
}

/** A model newer than the list is still a model: take it and say where it gets checked. */
function acceptUnlisted(ctx: AskContext, answer: string): Parsed<string> {
  if (answer === '') {
    return refuse(t(ctx.locale, 'cli.onboardModelRequired'))
  }

  ctx.app.out(warn(t(ctx.locale, 'cli.onboardModelUnlisted', { model: answer })))

  return accept(answer)
}

async function askBaseUrl(ctx: AskContext): Promise<string> {
  ctx.app.out(t(ctx.locale, 'cli.onboardBaseUrlIntro'))

  return await askUntilValid(ctx, t(ctx.locale, 'cli.onboardPromptBaseUrl'), (answer) =>
    URL.canParse(answer) && WEB_PROTOCOLS.has(new URL(answer).protocol)
      ? accept(answer)
      : refuse(t(ctx.locale, 'cli.onboardBaseUrlInvalid'))
  )
}

/** Only a provider that takes a key is asked for one; a login, a cloud account or a server on this
 *  machine signs in another way. */
async function askKeyEnv(
  ctx: AskContext,
  provider: ProviderEntry,
  baseUrl: string
): Promise<string | undefined> {
  if (provider.apiKeyEnv === '' || !requiresApiKey(provider, baseUrl)) {
    return undefined
  }

  ctx.app.out(t(ctx.locale, 'cli.onboardKeyIntro'))

  const question = `${t(ctx.locale, 'cli.onboardPromptKeyEnv')} [${provider.apiKeyEnv}]`

  return await askUntilValid(ctx, question, (answer) =>
    parseEnvName(answer === '' ? provider.apiKeyEnv : answer, ctx.locale)
  )
}

function noteOf(provider: ProviderEntry, locale: Locale): { readonly note?: string } {
  if (provider.authKind === 'oauth_subscription') {
    return { note: t(locale, 'cli.onboardNoteSubscription') }
  }

  if (!requiresApiKey(provider, provider.baseUrl)) {
    return { note: t(locale, 'cli.onboardNoteLocal') }
  }

  return isEnvSet(provider.apiKeyEnv)
    ? { note: t(locale, 'cli.onboardNoteKeyFound', { env: provider.apiKeyEnv }) }
    : {}
}

function knownModels(provider: ProviderEntry): readonly string[] {
  const listed = CATALOG_MODELS.filter((entry) => entry.provider === provider.id).map(
    (entry) => entry.model
  )
  const preferred = provider.defaultModel

  // Aliases share a model, so a model is listed once.
  return [...new Set(preferred === undefined ? listed : [preferred, ...listed])]
}

export function parseEnvName(answer: string, locale: Locale): Parsed<string> {
  return isEnvName(answer) ? accept(answer) : refuse(t(locale, 'cli.onboardEnvNameInvalid'))
}

export function isEnvSet(name: string): boolean {
  return (getEnv()[name] ?? '') !== ''
}

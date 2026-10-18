import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { Locale } from '@/core/types/locale'
import {
  findProviderById,
  hasIdentityEnv,
  IDENTITY_ENV,
  missingKeyErrors,
  requiresApiKey,
} from '@/ai/api'
import { bindLocale, t } from '@/i18n'

import type { DoctorEnvironment, DoctorProbe, ResolvedProviderModel } from './types'
import { checkLabel } from './labels'
import { unknownProviderProbes } from './local-probes'

export function probeModels(
  config: ResolvedConfig,
  env: DoctorEnvironment,
  locale: Locale
): readonly DoctorProbe[] {
  const name = checkLabel(locale, 'models')

  if (config.models.length === 0) {
    return [{ name, status: 'fail', detail: t(locale, 'cli.doctorNoModels') }]
  }

  const failures = [
    ...unsetKeyProbes(config, locale),
    ...missingApiKeyEnvProbes(config.models, locale),
    ...missingSignInProbes(config.models, env, locale),
  ]
  // The chain listing is only a pass when nothing below it fails; otherwise it reads as a contradiction.
  const summary: DoctorProbe = {
    name,
    status: failures.length === 0 ? 'ok' : 'info',
    detail: config.models.map((model) => `${model.provider}/${model.model}`).join(', '),
  }

  return [summary, ...failures]
}

// A named key variable that is unset: the same list `start` warns about and `config validate` reports.
function unsetKeyProbes(config: ResolvedConfig, locale: Locale): readonly DoctorProbe[] {
  return missingKeyErrors(config).map((err) => ({
    name: checkLabel(locale, 'models'),
    status: 'fail' as const,
    detail: bindLocale(locale).translate(err.operator.key, err.operator.params),
  }))
}

// A model whose entry names no api_key_env at all resolves with no key and no error; a named variable
// left unset is `unsetKeyProbes`'. The catalog is what knows which providers need a key, so this
// pre-flight check lives here rather than in core/config, which stays finance-vocab-free.
// `[[models]] provider` is a free string (core/config never validates it against the catalog), so a
// typo must degrade to a fail probe here, never throw and take the whole doctor report down with it.
function missingApiKeyEnvProbes(
  models: readonly ResolvedModel[],
  locale: Locale
): readonly DoctorProbe[] {
  const resolved = models.map((model) => ({ model, provider: findProviderById(model.provider) }))
  const missingKey = resolved
    .filter((entry): entry is ResolvedProviderModel => entry.provider !== undefined)
    .filter(({ model, provider }) => isKeyUnnamed(model) && provider.apiKeyEnv !== '')
    .filter(({ model, provider }) => requiresApiKey(provider, model.baseUrl ?? provider.baseUrl))
    .map(({ model, provider }) => ({
      name: checkLabel(locale, 'models'),
      status: 'fail' as const,
      detail: t(locale, 'cli.doctorModelMissingApiKeyEnv', {
        provider: provider.id,
        model: model.model,
        key: provider.apiKeyEnv,
      }),
    }))

  return [...unknownProviderProbes(models, checkLabel(locale, 'models'), locale), ...missingKey]
}

function isKeyUnnamed(model: ResolvedModel): boolean {
  return model.apiKey === undefined && model.missingEnv === undefined
}

// A cloud provider with no key signs in with the operator's cloud account, so its check is whether
// that account's variables are set, the same rule boot applies.
function missingSignInProbes(
  models: readonly ResolvedModel[],
  env: DoctorEnvironment,
  locale: Locale
): readonly DoctorProbe[] {
  return models.flatMap((model) => {
    const identity = findProviderById(model.provider)?.identity

    if (identity === undefined || model.apiKey !== undefined || hasIdentityEnv(identity, env)) {
      return []
    }

    const detail = t(locale, 'errors.configModelNoSignIn', {
      model: `${model.provider}/${model.model}`,
      env: IDENTITY_ENV[identity].join(', '),
    })

    return [{ name: checkLabel(locale, 'models'), status: 'fail' as const, detail }]
  })
}

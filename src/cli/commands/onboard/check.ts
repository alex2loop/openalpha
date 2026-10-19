import type { ProviderEntry } from '@/ai/api'
import { AUTH_PROVIDERS, createTokenFile, hasIdentityEnv } from '@/ai/api'
import { authCommand } from '@/cli/commands/auth'
import { probeProviders } from '@/cli/commands/doctor/online-probes'
import { getEnv } from '@/cli/env'
import { fail, hint, info, success } from '@/cli/ui/colors'
import { confirmDefaultYes } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { probeConfig } from '@/core/config/load'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { ModelAnswer } from './model-step'
import { printNextSteps } from './next-steps'
import { offerSaveKeys } from './save-key'

/** Signs in, tries the model once and lists what is left, after any write that set a model. */
export async function finishModelChange(
  ctx: AskContext,
  change: {
    readonly chosen: ModelAnswer
    readonly configPath: string
    readonly firstRun: boolean
    readonly telegramTokenEnv?: string
  }
): Promise<void> {
  const { chosen } = change

  await offerSignIn(ctx, chosen.provider)

  const signedIn = await isSignedIn(ctx, chosen.provider)
  const saved = await offerSaveKeys(ctx, [chosen.starter.apiKeyEnv, change.telegramTokenEnv])
  const keyInFile = chosen.starter.apiKeyEnv !== undefined && saved.has(chosen.starter.apiKeyEnv)

  // A call with no login or cloud account yet can only fail; the next steps already say what to set.
  // A key just saved is in the file, not in this process, so the probe could not see it either.
  if (signedIn && hasCloudAccount(chosen.provider) && !keyInFile) {
    await testModel(ctx, change.configPath)
  }

  printNextSteps(ctx, {
    provider: chosen.provider,
    model: chosen.starter,
    signedIn,
    saved,
    firstRun: change.firstRun,
    ...(change.telegramTokenEnv === undefined ? {} : { telegramTokenEnv: change.telegramTokenEnv }),
  })
}

/** True once a subscription provider holds a login; providers that take no login always are. */
async function isSignedIn(ctx: AskContext, provider: ProviderEntry): Promise<boolean> {
  const login = AUTH_PROVIDERS.find((authProvider) => authProvider.id === provider.id)

  if (login === undefined) {
    return true
  }

  return (await createTokenFile(ctx.app.config.paths.dataDir, login.id).read()) !== undefined
}

function hasCloudAccount(provider: ProviderEntry): boolean {
  return provider.identity === undefined || hasIdentityEnv(provider.identity, getEnv())
}

/** Offers the subscription login right here, so the model it just chose can answer. */
async function offerSignIn(ctx: AskContext, provider: ProviderEntry): Promise<void> {
  const login = AUTH_PROVIDERS.find((authProvider) => authProvider.id === provider.id)

  if (login === undefined || (await isSignedIn(ctx, provider))) {
    return
  }

  const question = t(ctx.locale, 'cli.onboardPromptSignIn', { provider: provider.displayName })

  if (!(await confirmDefaultYes(ctx.prompt, question, ctx.locale))) {
    return
  }

  // The login speaks the language just chosen, not the defaults setup started with.
  const { config } = ctx.app
  const app = {
    ...ctx.app,
    config: { ...config, locale: { ...config.locale, language: ctx.locale } },
  }

  await authCommand.exec(['login', login.loginName], app, [])
}

/** Sends the model one short message, the check `doctor --online` runs. Skipped while the config
 *  cannot load yet: a key or account is still to set, and the next steps say which. */
async function testModel(ctx: AskContext, configPath: string): Promise<void> {
  const probed = await probeConfig({ configPath, dataDir: ctx.app.config.paths.dataDir })
  const [model] = probed.config.models

  if (probed.error !== null || model === undefined) {
    return
  }

  ctx.app.out(info(t(ctx.locale, 'cli.onboardTesting', { model: model.model })))

  const probes = await probeProviders({
    config: probed.config,
    online: true,
    env: getEnv(),
    locale: ctx.locale,
  })

  for (const probe of probes) {
    const line = `${probe.name}: ${probe.detail}`

    ctx.app.out(probe.status === 'fail' ? fail(line) : success(line))
  }

  if (probes.some((probe) => probe.status === 'fail')) {
    ctx.app.out(hint(t(ctx.locale, 'cli.onboardTestFailedHint', { brand: BRAND.name })))
  }
}

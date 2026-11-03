import type { ProviderEntry } from '@/ai/api'
import { hasIdentityEnv } from '@/ai/api'
import { AUTH_PROVIDERS, createTokenFile } from '@/ai/node-api'
import { authCommand } from '@/cli/commands/auth'
import { probeProviders } from '@/cli/commands/doctor/online-probes'
import { getEnv } from '@/cli/env'
import { writeEnvFileValue } from '@/cli/env-file'
import { fail, hint, info, success } from '@/cli/ui/colors'
import { confirmDefaultYes } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { probeConfig } from '@/core/config/load'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { ModelAnswer } from './model-step'
import { isEnvSet } from './model-step'
import { printNextSteps } from './next-steps'
import { offerSaveKeys } from './save-key'
import { askSecContact, type HomeRegion, SEC_CONTACT_ENV } from './settings-step'

/** Signs in, tries the model once and lists what is left, after any write that set a model. */
export async function finishModelChange(
  ctx: AskContext,
  change: {
    readonly chosen: ModelAnswer
    readonly configPath: string
    readonly firstRun: boolean
    readonly region?: HomeRegion
    readonly telegramTokenEnv?: string
  }
): Promise<void> {
  const { chosen } = change

  await offerSignIn(ctx, chosen.provider)

  const signedIn = await isSignedIn(ctx, chosen.provider)
  const saved = new Set(
    await offerSaveKeys(ctx, [chosen.starter.apiKeyEnv, change.telegramTokenEnv])
  )

  if (change.region === 'us' && (await offerSecContact(ctx))) {
    saved.add(SEC_CONTACT_ENV)
  }

  // A call with no login or cloud account yet can only fail; the next steps already say what to set.
  if (signedIn && hasCloudAccount(chosen.provider)) {
    await testModel(ctx, change.configPath)
  }

  printNextSteps(ctx, {
    provider: chosen.provider,
    model: chosen.starter,
    signedIn,
    saved,
    firstRun: change.firstRun,
    ...(change.region === undefined ? {} : { region: change.region }),
    ...(change.telegramTokenEnv === undefined ? {} : { telegramTokenEnv: change.telegramTokenEnv }),
  })
}

/** The contact SEC asks for: shown as typed, saved to the key file, and in this process too so
 *  what follows reads it. Already set, or left empty, it is not asked or saved; true when saved. */
async function offerSecContact(ctx: AskContext): Promise<boolean> {
  if (isEnvSet(SEC_CONTACT_ENV)) {
    return false
  }

  const value = await askSecContact(ctx)

  if (value === undefined) {
    return false
  }

  const { path } = ctx.app.keyFile

  await writeEnvFileValue({ path, name: SEC_CONTACT_ENV, value })
  getEnv()[SEC_CONTACT_ENV] = value
  ctx.app.out(success(t(ctx.locale, 'cli.keySaved', { name: SEC_CONTACT_ENV, path })))

  return true
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
    surface: 'terminal',
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

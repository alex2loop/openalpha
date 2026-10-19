import type { ProviderEntry } from '@/ai/api'
import { AUTH_PROVIDERS, hasIdentityEnv, IDENTITY_ENV } from '@/ai/api'
import { getEnv } from '@/cli/env'
import { style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { StarterModel } from './config-file'
import { isEnvSet } from './model-step'

interface NextStepsInput {
  readonly provider?: ProviderEntry
  readonly model?: StarterModel
  readonly signedIn: boolean
  /** The names onboard just saved to the key file; their steps are done. */
  readonly saved: ReadonlySet<string>
  readonly telegramTokenEnv?: string
  /** A first setup also lists how to start; an edit lists what it left to do and the restart. */
  readonly firstRun: boolean
}

/** One numbered list of what is left, so the operator never has to guess the next command. */
export function printNextSteps(ctx: AskContext, input: NextStepsInput): void {
  const steps = [...accessSteps(ctx, input), ...startSteps(ctx, input)]

  if (steps.length === 0) {
    return
  }

  ctx.app.out('')
  ctx.app.out(style.heading(t(ctx.locale, 'cli.onboardNextTitle')))
  steps.forEach((step, index) => {
    ctx.app.out(`  ${index + 1}. ${step}`)
  })
}

function isStillToSave(input: NextStepsInput, name: string | undefined): name is string {
  return name !== undefined && !isEnvSet(name) && !input.saved.has(name)
}

function accessSteps(ctx: AskContext, input: NextStepsInput): readonly string[] {
  const { provider, model, telegramTokenEnv } = input
  const steps: string[] = []
  const keyEnv = model?.apiKeyEnv

  if (isStillToSave(input, keyEnv)) {
    steps.push(t(ctx.locale, 'cli.onboardStepSaveKey', { brand: BRAND.name, name: keyEnv }))
  }

  if (provider?.identity !== undefined && !hasIdentityEnv(provider.identity, getEnv())) {
    const names = IDENTITY_ENV[provider.identity].join(', ')

    steps.push(t(ctx.locale, 'cli.onboardStepIdentity', { names }))
  }

  const login = AUTH_PROVIDERS.find((authProvider) => authProvider.id === provider?.id)

  if (login !== undefined && !input.signedIn) {
    const command = `${BRAND.name} auth login ${login.loginName}`

    steps.push(t(ctx.locale, 'cli.onboardStepSignIn', { command }))
  }

  if (isStillToSave(input, telegramTokenEnv)) {
    const params = { brand: BRAND.name, name: telegramTokenEnv }

    steps.push(t(ctx.locale, 'cli.onboardStepSaveKey', params))
  }

  return steps
}

function startSteps(ctx: AskContext, input: NextStepsInput): readonly string[] {
  const params = { brand: BRAND.name }
  const pair =
    input.telegramTokenEnv === undefined ? [] : [t(ctx.locale, 'cli.onboardStepPair', params)]

  if (!input.firstRun) {
    return [...pair, t(ctx.locale, 'cli.onboardStepRestart', params)]
  }

  return [
    t(ctx.locale, 'cli.onboardStepChat', params),
    t(ctx.locale, 'cli.onboardStepDeposit'),
    t(ctx.locale, 'cli.onboardStepDaemon', params),
    ...pair,
    t(ctx.locale, 'cli.onboardStepDoctor', params),
  ]
}

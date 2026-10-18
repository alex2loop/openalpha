import type { ProviderEntry } from '@/ai/api'
import { AUTH_PROVIDERS, hasIdentityEnv, IDENTITY_ENV } from '@/ai/api'
import { getEnv } from '@/cli/env'
import { hint, style } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { setEnvCommand } from '@/core/config/resolve'
import { t } from '@/i18n'

import type { AskContext } from './ask'
import type { StarterModel } from './config-file'
import { isEnvSet } from './model-step'

const WINDOWS = 'win32'

interface NextStepsInput {
  readonly provider?: ProviderEntry
  readonly model?: StarterModel
  readonly signedIn: boolean
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

  if (process.platform !== WINDOWS && unsetEnvNames(input).length > 0) {
    ctx.app.out(hint(t(ctx.locale, 'cli.onboardKeepEnvHint')))
  }
}

function unsetEnvNames(input: NextStepsInput): readonly string[] {
  return [input.model?.apiKeyEnv, input.telegramTokenEnv].filter(
    (name): name is string => name !== undefined && !isEnvSet(name)
  )
}

function accessSteps(ctx: AskContext, input: NextStepsInput): readonly string[] {
  const { provider, model, telegramTokenEnv } = input
  const steps: string[] = []
  const keyEnv = model?.apiKeyEnv

  if (keyEnv !== undefined && !isEnvSet(keyEnv)) {
    steps.push(t(ctx.locale, 'cli.onboardStepSetKey', { command: setEnvCommand(keyEnv) }))
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

  if (telegramTokenEnv !== undefined && !isEnvSet(telegramTokenEnv)) {
    const command = setEnvCommand(telegramTokenEnv)

    steps.push(t(ctx.locale, 'cli.onboardStepSetTelegram', { command }))
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

import type { ProviderEntry } from '@/ai/api'
import type { Command, Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import { CATALOG_MODELS, PROVIDERS } from '@/ai/api'
import { createCommand, createGroup } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { hint, style } from '@/cli/ui/colors'
import { t } from '@/i18n'

const NOT_SET = '—'
const PROVIDER_LIST: readonly ProviderEntry[] = PROVIDERS

const providerCmdList: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.providerListSummary' },
  needs: { boot: false, configFile: 'optional' },
  run: listProviders,
})

const providerCmdModels: Command = createCommand({
  name: 'models',
  summary: { key: 'cliHelp.providerModelsSummary' },
  run: listModels,
})

export const providerCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.provider,
  subcommands: [providerCmdList, providerCmdModels],
})

function listProviders(_args: ParsedArgs, app: CliApp): number {
  const locale = app.config.locale.language
  const width = Math.max(...PROVIDER_LIST.map((provider) => provider.id.length))

  for (const provider of PROVIDER_LIST) {
    app.out(`${style.heading(provider.id.padEnd(width))}  ${hint(provider.displayName)}`)
    app.out(
      t(locale, 'cli.providerDetails', {
        transport: provider.transport,
        auth: authLabel(locale, provider),
        model: provider.defaultModel ?? NOT_SET,
      })
    )
  }

  return 0
}

function authLabel(locale: Locale, provider: ProviderEntry): string {
  if (provider.authKind === 'oauth_subscription') {
    return t(locale, 'cli.providerOauth')
  }

  return provider.apiKeyEnv === ''
    ? t(locale, 'cli.providerNoKey')
    : t(locale, 'cli.providerApiKeyEnv', { value: provider.apiKeyEnv })
}

function listModels(_args: ParsedArgs, app: CliApp): number {
  const locale = app.config.locale.language
  const width = Math.max(...CATALOG_MODELS.map((catalogModel) => catalogModel.name.length))
  const pricing = app.resolve('pricing')

  for (const catalogModel of CATALOG_MODELS) {
    const { price, source } = pricing.priceOf({
      provider: catalogModel.provider,
      model: catalogModel.model,
    })
    const ref = `${catalogModel.provider}:${catalogModel.model}`
    app.out(`${style.heading(catalogModel.name.padEnd(width))}  ${hint(ref)}`)
    app.out(
      t(locale, 'cli.providerPricing', {
        input: price.inPerM,
        output: price.outPerM,
        source,
      })
    )
  }

  return 0
}

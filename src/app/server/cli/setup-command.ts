import type { SetupResult } from '@/app/server/wire/config'
import type { CliApp, Command } from '@/cli/api'
import { findProviderById } from '@/ai/api'
import { validateBootConfigTree } from '@/app/config-tree'
import { buildProviderCatalog } from '@/app/server/cli/catalog'
import { createCommand, isConfigPresent, starterConfigToml } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { parseConfigToml, probeConfig } from '@/core/config/load'
import { ConfigError } from '@/core/errors'
import { createPrivateFileAtomic } from '@/core/security/private-files'

const EXIT_REFUSED = 1

/** The app's first run, before any config exists: `setup catalog` lists the providers, `setup write
 *  <provider> <model>` writes the starter config with the API on. Output is one JSON line. The key
 *  never passes through here: the config names its environment variable, and the app hands the
 *  value to the daemon it starts. */
export const setupCommand: Command = createCommand({
  name: 'setup',
  summary: { key: 'cliHelp.commandSetupSummary', params: { brand: BRAND.display } },
  spec: { positional: ['action', 'provider', 'model'], positionalOptional: true },
  needs: { boot: false, configFile: 'optional' },
  async run(args, app): Promise<number> {
    const action = positional(args.action)
    const provider = positional(args.provider)
    const model = positional(args.model)

    if (action === 'catalog') {
      return answer(app, { ok: true, catalog: buildProviderCatalog() })
    }

    if (action === 'write' && provider !== undefined && model !== undefined) {
      return writeStarterConfig(app, provider, model)
    }

    return answer(app, { ok: false, code: 'usage' })
  },
})

async function writeStarterConfig(app: CliApp, provider: string, model: string): Promise<number> {
  const entry = findProviderById(provider)
  const keyEnv = entry?.apiKeyEnv ?? ''
  // A subscription provider signs in with a login, so its model entry names no key variable.
  const subscription = entry?.authKind === 'oauth_subscription'

  if (entry === undefined || (keyEnv === '' && !subscription)) {
    return answer(app, { ok: false, code: 'unknown_provider' })
  }

  const configPath = app.configProbe?.configPath ?? (await probeConfig()).configPath

  if (await isConfigPresent(configPath)) {
    return answer(app, { ok: false, code: 'config_exists', configPath })
  }

  const content = starterConfigToml({
    model: { provider, model, ...(subscription ? {} : { apiKeyEnv: keyEnv }) },
  })

  if (!isValidConfig(content)) {
    return answer(app, { ok: false, code: 'invalid' })
  }

  await createPrivateFileAtomic({ path: configPath, content })

  return answer(app, { ok: true, configPath, keyEnv })
}

/** A schema problem is a refusal the app words; anything else is a fault. */
function isValidConfig(content: string): boolean {
  try {
    return validateBootConfigTree(parseConfigToml(content)).ok
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      return false
    }

    throw err
  }
}

function positional(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function answer(app: CliApp, result: SetupResult): number {
  app.out(JSON.stringify(result))

  return result.ok ? 0 : EXIT_REFUSED
}

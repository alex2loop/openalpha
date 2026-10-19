import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import { createCommand, createGroup, type Group, type Needs } from '@/cli/command'
import { resolveLauncher } from '@/cli/commands/autostart/launchers'
import { getEnv } from '@/cli/env'
import { readEnvFile } from '@/cli/env-file'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { keyEnvNames } from '@/cli/missing-keys'
import { buildSelfArgv } from '@/cli/services'
import { hint, success } from '@/cli/ui/colors'
import { isCompiledBinary } from '@/cli/update/release'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

const START_TAIL = ['start', '--background'] as const
const NAME_SEPARATOR = ', '
const AUTOSTART_NEEDS: Needs = { boot: false, configFile: 'optional', daemon: 'any' }

const autostartEnableCommand = createCommand({
  name: 'enable',
  summary: { key: 'cliHelp.autostartEnableSummary' },
  needs: AUTOSTART_NEEDS,
  run: enable,
})

const autostartDisableCommand = createCommand({
  name: 'disable',
  summary: { key: 'cliHelp.autostartDisableSummary' },
  needs: AUTOSTART_NEEDS,
  run: disable,
})

const autostartStatusCommand = createCommand({
  name: 'status',
  summary: { key: 'cliHelp.autostartStatusSummary' },
  needs: AUTOSTART_NEEDS,
  run: status,
})

export const autostartCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.autostart,
  subcommands: [autostartEnableCommand, autostartDisableCommand, autostartStatusCommand],
  default: 'status',
})

async function enable(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language

  if (!isCompiledBinary()) {
    return usage(app, t(locale, 'cli.autostartSourceCheckout'))
  }

  const launcher = resolveLauncher(process.platform)

  if (launcher === undefined) {
    return usage(app, t(locale, 'cli.autostartUnsupported'))
  }

  // It starts the background daemon, so `upgrade`, `/upgrade confirm` and `[update] auto` keep
  // working unchanged.
  const argv = await buildSelfArgv({
    dataDir: app.config.paths.dataDir,
    configPath: app.configPath,
    tail: START_TAIL,
  })

  await launcher.install(argv)
  app.out(success(t(locale, 'cli.autostartOn')))

  if (process.platform === 'linux') {
    app.out(hint(t(locale, 'cli.autostartLingerHint')))
  }

  const unsaved = await shellOnlyKeys(app)

  if (unsaved.length > 0) {
    const names = unsaved.join(NAME_SEPARATOR)

    app.out(hint(t(locale, 'cli.autostartKeysHint', { names, brand: BRAND.name })))
  }

  return 0
}

async function disable(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const launcher = resolveLauncher(process.platform)

  if (launcher === undefined || !(await launcher.isInstalled())) {
    app.out(t(locale, 'cli.autostartOff', { brand: BRAND.name }))

    return 0
  }

  await launcher.uninstall()
  app.out(success(t(locale, 'cli.autostartDisabled')))

  return 0
}

async function status(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const launcher = resolveLauncher(process.platform)

  if (launcher === undefined) {
    app.out(t(locale, 'cli.autostartUnsupported'))

    return 0
  }

  const installed = await launcher.isInstalled()

  app.out(t(locale, installed ? 'cli.autostartOn' : 'cli.autostartOff', { brand: BRAND.name }))

  return 0
}

/** A launch at login does not see variables exported only in a shell: the config's key names that
 *  are set here but absent from the key file. Names only, never values. */
async function shellOnlyKeys(app: CliApp): Promise<readonly string[]> {
  if (app.configProbe?.configError !== null || app.configProbe.configMissing) {
    return []
  }

  const env = getEnv()
  const saved = await readEnvFile(app.keyFile.path)

  return keyEnvNames(app.config).filter((name) => (env[name] ?? '') !== '' && !saved.has(name))
}

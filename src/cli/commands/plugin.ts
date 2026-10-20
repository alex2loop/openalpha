import type { Command, Group } from '@/cli/command'
import type { ParsedArgs } from '@/cli/parsing/args'
import type { CliApp } from '@/cli/types'
import { createCommand, createGroup } from '@/cli/command'
import { usage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA, CLI_FLAG_DESCRIPTIONS } from '@/cli/metadata'
import { flagBool, flagString } from '@/cli/parsing/args'
import { hint, style, success } from '@/cli/ui/colors'
import { confirm, declined, defaultPrompt } from '@/cli/ui/prompt'
import { BRAND } from '@/core/brand'
import { pluralKey, t } from '@/i18n'
import {
  discoverInstalledPlugins,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
} from '@/plugins/api'

const pluginCmdList: Command = createCommand({
  name: 'list',
  summary: { key: 'cliHelp.pluginListSummary' },
  run: listPlugins,
})

const pluginCmdInstall: Command = createCommand({
  name: 'install',
  summary: { key: 'cliHelp.pluginInstallSummary' },
  spec: {
    positional: ['ref'],
    flags: { yes: { type: 'boolean', describe: CLI_FLAG_DESCRIPTIONS.skipConfirmation } },
  },
  run: install,
})

const pluginCmdUpdate: Command = createCommand({
  name: 'update',
  summary: { key: 'cliHelp.pluginUpdateSummary' },
  spec: { positional: ['id'] },
  run: update,
})

const pluginCmdUninstall: Command = createCommand({
  name: 'uninstall',
  summary: { key: 'cliHelp.pluginUninstallSummary' },
  spec: { positional: ['id'] },
  run: uninstall,
})

export const pluginCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.plugin,
  subcommands: [pluginCmdList, pluginCmdInstall, pluginCmdUpdate, pluginCmdUninstall],
})

async function listPlugins(_args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const dirs = app.config.plugins.dirs

  if (dirs.length === 0) {
    app.out(hint(t(locale, 'cli.pluginNoDirs')))

    return 0
  }

  const logger = app.resolve('logger')
  const found = (await Promise.all(dirs.map((dir) => discoverInstalledPlugins(dir, logger)))).flat()

  if (found.length === 0) {
    app.out(hint(t(locale, 'cli.pluginNoPlugins')))

    return 0
  }

  for (const plugin of found) {
    const agents = plugin.contributions.agents?.length ?? 0
    app.out(
      `${style.heading(plugin.id)}  ${hint(t(locale, pluralKey(agents, 'cli.pluginAgentCountOne', 'cli.pluginAgentCount'), { count: agents }))}`
    )
  }

  return 0
}

async function install(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const ref = flagString(args, 'ref')

  if (ref === undefined) {
    return usage(app, t(locale, 'cli.pluginInstallRequiresRef'))
  }

  const pluginsDir = installDir(app)

  if (pluginsDir === undefined) {
    return usage(app, t(locale, 'cli.pluginNoDirsConfigured'))
  }

  if (!flagBool(args, 'yes')) {
    const message = t(locale, 'cli.pluginInstallConfirm', { ref, path: pluginsDir })
    const proceed = await confirm(defaultPrompt(), message, locale)

    if (!proceed) {
      return declined(app)
    }
  }

  const result = await installPlugin({
    source: ref,
    pluginsDir,
    bundledIds: app.resolve('bundledPluginIds'),
  })
  app.out(success(t(locale, 'cli.pluginInstalled', { id: result.id })))

  return 0
}

// Reinstalls from the `.source` the original install recorded; the daemon loads plugins at boot, so
// a running one keeps serving the old code until it restarts.
async function update(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = flagString(args, 'id')

  if (id === undefined) {
    return usage(app, t(locale, 'cli.pluginUpdateRequiresId'))
  }

  const pluginsDir = installDir(app)

  if (pluginsDir === undefined) {
    return usage(app, t(locale, 'cli.pluginNoDirsConfigured'))
  }

  await updatePlugin(id, pluginsDir, app.resolve('bundledPluginIds'))
  app.out(success(t(locale, 'cli.pluginUpdated', { id, brand: BRAND.name })))

  return 0
}

async function uninstall(args: ParsedArgs, app: CliApp): Promise<number> {
  const locale = app.config.locale.language
  const id = flagString(args, 'id')

  if (id === undefined) {
    return usage(app, t(locale, 'cli.pluginUninstallRequiresId'))
  }

  const pluginsDir = installDir(app)

  if (pluginsDir === undefined) {
    return usage(app, t(locale, 'cli.pluginNoDirsConfigured'))
  }

  await uninstallPlugin(id, pluginsDir, app.resolve('bundledPluginIds'))
  app.out(success(t(locale, 'cli.pluginUninstalled', { id })))

  return 0
}

// Writes go to the first configured dir; the rest are read-only search paths.
function installDir(app: CliApp): string | undefined {
  return app.config.plugins.dirs[0]
}

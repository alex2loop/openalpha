import type { CliApp } from '@/cli/types'
import { type Command, createCommand, hasConfigError } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { formatUpdateStatus, formatVersionLine } from '@/cli/update/notice'
import { isUpdateCheckEnabled, refreshUpdateState } from '@/cli/update/state'

// No-boot lane: answerable from the manifest and the update cache, never app.resolve(...). A broken
// config still prints the version; the update cache is skipped because its data dir is unknown.
export const versionCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.version,
  needs: { boot: false, configFile: 'probe' },
  run: (_args, app) => printVersion(app),
})

async function printVersion(app: CliApp): Promise<number> {
  app.out(formatVersionLine())

  if (hasConfigError(app) || !isUpdateCheckEnabled(app.config)) {
    return 0
  }

  const state = await refreshUpdateState({ dataDir: app.config.paths.dataDir, now: Date.now() })

  for (const line of formatUpdateStatus(app.config.locale.language, state)) {
    app.out(line)
  }

  return 0
}

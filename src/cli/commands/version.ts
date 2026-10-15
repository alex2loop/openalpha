import type { CliApp } from '@/cli/types'
import { type Command, createCommand, hasConfigError } from '@/cli/command'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { style } from '@/cli/ui/colors'
import { formatUpdateStatus } from '@/cli/update/notice'
import { isUpdateCheckEnabled, refreshUpdateState } from '@/cli/update/state'
import { BRAND } from '@/core/brand'

// No-boot lane: answerable from the manifest and the update cache, never app.resolve(...). A broken
// config still prints the version; the update cache is skipped because its data dir is unknown.
export const versionCommand: Command = createCommand({
  ...CLI_COMMAND_METADATA.version,
  needs: { boot: false, configFile: 'probe' },
  run: (_args, app) => printVersion(app),
})

async function printVersion(app: CliApp): Promise<number> {
  app.out(`${style.heading(BRAND.display)} ${style.muted(`v${BRAND.version}`)}`)

  if (hasConfigError(app) || !(await isUpdateCheckEnabled(app.config))) {
    return 0
  }

  const state = await refreshUpdateState({ dataDir: app.config.paths.dataDir, now: Date.now() })

  for (const line of formatUpdateStatus(app.config.locale.language, state)) {
    app.out(line)
  }

  return 0
}

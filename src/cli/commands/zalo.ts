import type { CliApp } from '@/cli/types'
import type { Locale } from '@/core/types/locale'
import {
  loginZaloPersonal,
  parseZaloPersonalConfig,
  type ZaloPersonalLoginOutcome,
  type ZaloPersonalLoginProgress,
} from '@/channels/api'
import { createCommand, createGroup, type Group } from '@/cli/command'
import { terminalErrorMessage } from '@/cli/error-output'
import { CLI_COMMAND_METADATA } from '@/cli/metadata'
import { flagString } from '@/cli/parsing/args'
import { fail, hint, success } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'

const ZALO_PERSONAL_CHANNEL = 'zalo_personal'
// Each QR is refreshed by Zalo every 100 seconds; this bounds how long the terminal waits overall.
const ZALO_LOGIN_TIMEOUT_MS = 5 * MS_PER_MINUTE

const zaloLoginCommand = createCommand({
  name: 'login',
  summary: { key: 'cliHelp.zaloLoginSummary' },
  // Linking an account must work before the channel is configured, so it reads only the data dir.
  needs: { boot: false, configFile: 'optional' },
  spec: {
    flags: { profile: { type: 'string', describe: { key: 'cliHelp.flagZaloProfile' } } },
  },
  async run(args, app): Promise<number> {
    const locale = app.config.locale.language

    try {
      const profile =
        flagString(args, 'profile') ??
        parseZaloPersonalConfig(app.config.channels[ZALO_PERSONAL_CHANNEL]).profile
      const outcome = await loginZaloPersonal({
        location: { dataDir: app.config.paths.dataDir, profile },
        signal: AbortSignal.timeout(ZALO_LOGIN_TIMEOUT_MS),
        onProgress: (progress) => app.out(toProgressLine(progress, locale)),
      })

      return reportOutcome(app, outcome)
    } catch (err: unknown) {
      app.err(fail(t(locale, 'cli.zaloLoginFailed', { reason: terminalErrorMessage(err, locale) })))

      return 1
    }
  },
})

export const zaloCommand: Group = createGroup({
  ...CLI_COMMAND_METADATA.zalo,
  subcommands: [zaloLoginCommand],
})

function toProgressLine(progress: ZaloPersonalLoginProgress, locale: Locale): string {
  if (progress.kind === 'qr-ready') {
    return t(locale, 'cli.zaloLoginQrReady', { path: progress.path })
  }

  return hint(t(locale, 'cli.zaloLoginScanned', { name: progress.name }))
}

function reportOutcome(app: CliApp, outcome: ZaloPersonalLoginOutcome): number {
  const locale = app.config.locale.language

  switch (outcome.kind) {
    case 'linked':
      app.out(success(t(locale, 'cli.zaloLoginLinked', { name: outcome.name, brand: BRAND.name })))
      return 0
    case 'declined':
      app.err(fail(t(locale, 'cli.zaloLoginDeclined', { brand: BRAND.name })))
      return 1
    case 'expired':
      app.err(
        fail(
          t(locale, 'cli.zaloLoginExpired', {
            brand: BRAND.name,
            minutes: ZALO_LOGIN_TIMEOUT_MS / MS_PER_MINUTE,
          })
        )
      )
      return 1
    default:
      return outcome satisfies never
  }
}

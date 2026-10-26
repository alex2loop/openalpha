import { isIPv6 } from 'node:net'

import type { CliApp, Command } from '@/cli/api'
import { withApiToken } from '@/app/server/cli/api-token'
import { resolveSshAddress, toSshTarget } from '@/app/server/cli/ssh-address'
import { createCommand, getEnv, hint } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

/** The line the desktop app pastes to reach this daemon: its public URL, or an SSH tunnel spec. */
export const connectCommand: Command = createCommand({
  name: 'connect',
  summary: { key: 'cliHelp.connectSummary' },
  needs: { boot: false },
  run: (_args, app) => withApiToken(app, (token) => printConnectLine(app, token)),
})

function printConnectLine(app: CliApp, token: string): void {
  const locale = app.config.locale.language
  const { port: apiPort, publicUrl } = app.config.api
  const fragment = `#token=${encodeURIComponent(token)}`

  if (publicUrl !== undefined) {
    app.out(`${publicUrl}${fragment}`)
  } else {
    const { user, host, port, guessed } = resolveSshAddress(getEnv())
    const hostForUrl = isIPv6(host) ? `[${host}]` : host
    const sshPort = port === undefined ? '' : `:${port}`

    app.out(
      `${BRAND.name}+ssh://${toSshTarget(user, hostForUrl)}${sshPort}?api=${apiPort}${fragment}`
    )

    if (guessed) {
      app.out(hint(t(locale, 'cli.sshHostGuess', { host })))
    }
  }

  app.out(hint(t(locale, 'cli.connectNote')))
}

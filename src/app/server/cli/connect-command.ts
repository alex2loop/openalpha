import { isIPv6 } from 'node:net'

import type { CliApp, Command } from '@/cli/api'
import { readApiDown, withApiToken } from '@/app/server/cli/api-token'
import { resolveSshAddress, toSshTarget } from '@/app/server/cli/ssh-address'
import { createCommand, fail, getEnv, hint } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

/** What the desktop app needs to reach this daemon: its public URL or an SSH tunnel spec, and the
 *  token, each on its own line so neither lands in a browser's address bar. */
export const connectCommand: Command = createCommand({
  name: 'connect',
  summary: { key: 'cliHelp.connectSummary' },
  needs: { boot: false },
  run: (_args, app) => connect(app),
})

async function connect(app: CliApp): Promise<number> {
  const apiDown = await readApiDown(app)

  if (apiDown !== undefined) {
    app.err(fail(apiDown))

    return 1
  }

  return await withApiToken(app, (token) => printConnectLine(app, token))
}

function printConnectLine(app: CliApp, token: string): void {
  const locale = app.config.locale.language
  const { port: apiPort, publicUrl } = app.config.api

  if (publicUrl !== undefined) {
    app.out(t(locale, 'cli.connectAddress', { value: publicUrl }))
  } else {
    const { user, host, port, guessed } = resolveSshAddress(getEnv())
    const hostForUrl = isIPv6(host) ? `[${host}]` : host
    const sshPort = port === undefined ? '' : `:${port}`

    app.out(
      t(locale, 'cli.connectAddress', {
        value: `${BRAND.name}+ssh://${toSshTarget(user, hostForUrl)}${sshPort}?api=${apiPort}`,
      })
    )

    if (guessed) {
      app.out(hint(t(locale, 'cli.sshHostGuess', { host })))
    }
  }

  app.out(t(locale, 'cli.connectToken', { value: token }))
  app.out(hint(t(locale, 'cli.connectNote')))
}

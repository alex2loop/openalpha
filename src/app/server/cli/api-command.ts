import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'

import type { CliApp, Group } from '@/cli/api'
import { printApiDisabled, withApiToken } from '@/app/server/cli/api-token'
import { apiTokenPath } from '@/app/server/http/auth'
import { createCommand, createGroup, hint } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { t } from '@/i18n'

const TOKEN_BYTES = 32

const authTokenCommand = createCommand({
  name: 'token',
  summary: { key: 'cliHelp.apiAuthTokenSummary' },
  run: (_args, app) => printToken(app),
})

const authRotateCommand = createCommand({
  name: 'rotate',
  summary: { key: 'cliHelp.apiAuthRotateSummary' },
  run: (_args, app) => rotateToken(app),
})

// Named `api`, not `auth`: the runtime's built-in `auth` group (provider logins) is matched first
// and would hide this one.
export const apiCommand: Group = createGroup({
  name: 'api',
  summary: { key: 'cliHelp.apiAuthSummary' },
  subcommands: [authTokenCommand, authRotateCommand],
})

function printToken(app: CliApp): Promise<number> {
  return withApiToken(app, (token) => {
    app.out(token)
  })
}

async function rotateToken(app: CliApp): Promise<number> {
  if (!app.config.api.enabled) {
    return printApiDisabled(app)
  }

  const tokenEnv = app.config.api.tokenEnv

  if (tokenEnv !== undefined) {
    app.out(t(app.config.locale.language, 'cli.authTokenManagedByEnv', { env: tokenEnv }))

    return 0
  }

  const path = apiTokenPath(app.config.paths.dataDir)

  await unlink(path).catch(() => undefined)

  const token = randomBytes(TOKEN_BYTES).toString('hex')

  await replacePrivateFileAtomic({ path, content: JSON.stringify({ token }, null, 2) })

  const locale = app.config.locale.language

  // Printed before the sessions go, so a failed removal never hides the new token.
  app.out(token)

  const signedOut = await app.resolve('browserSessionStore').removeAll()

  app.out(t(locale, 'cli.apiRotateSignedOut', { count: signedOut }))
  app.out(hint(t(locale, 'cli.authTokenRestart', { brand: BRAND.name })))

  return 0
}

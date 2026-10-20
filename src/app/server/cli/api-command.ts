import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'

import type { CliApp, Group } from '@/cli/api'
import { apiTokenPath } from '@/app/server/http/auth'
import { createCommand, createGroup, fail, getEnv, hint } from '@/cli/api'
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

async function printToken(app: CliApp): Promise<number> {
  if (!app.config.api.enabled) {
    return printApiDisabled(app)
  }

  const tokenEnv = app.config.api.tokenEnv

  if (tokenEnv !== undefined) {
    const value = getEnv()[tokenEnv] ?? ''

    if (value === '') {
      app.err(fail(t(app.config.locale.language, 'cli.authTokenEnvEmpty', { env: tokenEnv })))

      return 1
    }

    app.out(value)

    return 0
  }

  const token = await readTokenFile(app.config.paths.dataDir)

  if (token === null) {
    app.err(fail(t(app.config.locale.language, 'cli.authTokenMissing', { brand: BRAND.name })))

    return 1
  }

  app.out(token)

  return 0
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

  app.out(token)
  app.out(hint(t(app.config.locale.language, 'cli.authTokenRestart', { brand: BRAND.name })))

  return 0
}

/** A disabled server reads no token, so neither showing nor minting one means anything yet. */
function printApiDisabled(app: CliApp): number {
  app.out(t(app.config.locale.language, 'cli.authApiDisabled'))

  return 0
}

async function readTokenFile(dataDir: string): Promise<string | null> {
  const file = Bun.file(apiTokenPath(dataDir))

  if (!(await file.exists())) {
    return null
  }

  const parsed: unknown = await file.json().catch(() => null)

  if (typeof parsed !== 'object' || parsed === null || !('token' in parsed)) {
    return null
  }

  return typeof parsed.token === 'string' ? parsed.token : null
}

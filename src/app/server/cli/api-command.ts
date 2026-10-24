import { randomBytes } from 'node:crypto'
import { unlink } from 'node:fs/promises'

import type { CliApp, Group } from '@/cli/api'
import { apiTokenPath } from '@/app/server/http/auth'
import { LOOPBACK_HOST } from '@/app/server/http/server'
import { createCommand, createGroup, fail, getEnv, hint } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { t } from '@/i18n'

const TOKEN_BYTES = 32

type ApiTokenRead =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly message: string }

const authTokenCommand = createCommand({
  name: 'token',
  summary: { key: 'cliHelp.apiAuthTokenSummary' },
  run: (_args, app) => printToken(app),
})

const authLinkCommand = createCommand({
  name: 'link',
  summary: { key: 'cliHelp.apiLinkSummary' },
  run: (_args, app) => printLink(app),
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
  subcommands: [authTokenCommand, authLinkCommand, authRotateCommand],
})

function printToken(app: CliApp): Promise<number> {
  return withApiToken(app, (token) => {
    app.out(token)
  })
}

function printLink(app: CliApp): Promise<number> {
  return withApiToken(app, (token) => {
    app.out(`http://${LOOPBACK_HOST}:${app.config.api.port}/#token=${token}`)
    app.out(hint(t(app.config.locale.language, 'cli.apiLinkHint')))
  })
}

/** Runs `show` with the token, or says why there is none: the API is off, or no token is set. */
async function withApiToken(app: CliApp, show: (token: string) => void): Promise<number> {
  if (!app.config.api.enabled) {
    return printApiDisabled(app)
  }

  const read = await readApiToken(app)

  if (!read.ok) {
    app.err(fail(read.message))

    return 1
  }

  show(read.token)

  return 0
}

/** The token the daemon accepts: `token_env` when set, else the one in the data dir. */
async function readApiToken(app: CliApp): Promise<ApiTokenRead> {
  const locale = app.config.locale.language
  const tokenEnv = app.config.api.tokenEnv

  if (tokenEnv !== undefined) {
    const value = getEnv()[tokenEnv] ?? ''

    return value === ''
      ? { ok: false, message: t(locale, 'cli.authTokenEnvEmpty', { env: tokenEnv }) }
      : { ok: true, token: value }
  }

  const token = await readTokenFile(app.config.paths.dataDir)

  return token === null
    ? { ok: false, message: t(locale, 'cli.authTokenMissing', { brand: BRAND.name }) }
    : { ok: true, token }
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

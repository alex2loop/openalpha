import type { CliApp } from '@/cli/api'
import { apiTokenPath } from '@/app/server/http/auth'
import { fail, getEnv } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

type ApiTokenRead =
  | { readonly ok: true; readonly token: string }
  | { readonly ok: false; readonly message: string }

/** Runs `show` with the token, or says why there is none: the API is off, or no token is set. */
export async function withApiToken(app: CliApp, show: (token: string) => void): Promise<number> {
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
export async function readApiToken(app: CliApp): Promise<ApiTokenRead> {
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

/** A disabled server reads no token, so neither showing nor minting one means anything yet. */
export function printApiDisabled(app: CliApp): number {
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

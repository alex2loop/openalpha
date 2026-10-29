import type { CliApp } from '@/cli/api'
import type { Locale } from '@/core/types/locale'
import {
  ApiTokenError,
  apiTokenPath,
  isApiTokenUsable,
  resolveTokenEnv,
} from '@/app/server/http/auth'
import { fail, getEnv } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { bindLocale, t } from '@/i18n'

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

/** The token the daemon accepts: `token_env` when set, else the one in the data dir. The refusal is
 *  the daemon's own: a variable it would not start with names its cause. */
export async function readApiToken(app: CliApp): Promise<ApiTokenRead> {
  const locale = app.config.locale.language
  const tokenEnv = app.config.api.tokenEnv

  if (tokenEnv !== undefined) {
    return readTokenEnv(tokenEnv, locale)
  }

  const token = await readTokenFile(app.config.paths.dataDir)

  return token === null
    ? { ok: false, message: t(locale, 'cli.authTokenMissing', { brand: BRAND.name }) }
    : { ok: true, token }
}

function readTokenEnv(tokenEnv: string, locale: Locale): ApiTokenRead {
  try {
    return { ok: true, token: resolveTokenEnv(tokenEnv, getEnv()) }
  } catch (err: unknown) {
    if (!(err instanceof ApiTokenError)) {
      throw err
    }

    return {
      ok: false,
      message: bindLocale(locale).translate(err.operator.key, err.operator.params),
    }
  }
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

  return isApiTokenUsable(parsed.token) ? parsed.token : null
}

import type { CliApp } from '@/cli/api'
import { clearRestartMarker, writeRestartMarker } from '@/app/update/restart-marker'
import { execSelf, fail, getEnv, hint, isRestartRequested } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { formatErrForLog } from '@/core/security/credentials'
import { t } from '@/i18n'

const FAILED_EXIT_CODE = 1

/** The last step of a stop that asked for a restart, once nothing of this run is left open: the
 *  same command line starts again in this process. A restart that cannot start leaves the daemon
 *  stopped, so it says so and returns the exit code. The logger is closed by now, so the line on
 *  stderr is the record; for a background daemon that is its error log. */
export async function restartInPlaceIfRequested(app: CliApp): Promise<number | undefined> {
  if (!isRestartRequested()) {
    return undefined
  }

  const { dataDir } = app.config.paths
  const locale = app.config.locale.language

  try {
    await writeRestartMarker(dataDir, Date.now())
    app.out(hint(t(locale, 'cli.daemonRestarting')))
    execSelf(restartEnv(app))
  } catch (err: unknown) {
    await clearRestartMarker(dataDir).catch(() => {
      // The marker expires on its own, and takeRestartMarker ignores a stale one.
    })
    app.err(
      fail(
        t(locale, 'cli.daemonRestartFailed', {
          message: formatErrForLog(err).message,
          brand: BRAND.name,
        })
      )
    )

    return FAILED_EXIT_CODE
  }

  return undefined
}

/** A name the key file set is left out: the new run reads the file again, so a key changed or
 *  removed since applies. */
function restartEnv(app: CliApp): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [name, value] of Object.entries(getEnv())) {
    if (value !== undefined && !app.keyFile.loaded.has(name)) {
      env[name] = value
    }
  }

  return env
}

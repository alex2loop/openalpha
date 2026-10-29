import type { CliApp } from '@/cli/api'
import { readApiDown, readApiToken } from '@/app/server/cli/api-token'
import { hint, isDaemonReady, liveDaemon, waitUntilDaemonReady, warn } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { t } from '@/i18n'

type ExecTarget =
  | { readonly kind: 'daemon'; readonly port: number; readonly token: string }
  | { readonly kind: 'local' }

const LOCAL: ExecTarget = { kind: 'local' }

/** Where this command runs: the daemon when one owns this data dir, loaded this config, runs this
 *  version and serves the API with a token this CLI can read; anything else runs here. Only a
 *  version mismatch says so, since restarting the daemon is the operator's fix. */
export async function resolveExecTarget(app: CliApp): Promise<ExecTarget> {
  if (!app.config.api.enabled) {
    return LOCAL
  }

  const daemon = await liveDaemon(app)

  if (daemon === null || daemon.configPath !== app.configPath) {
    return LOCAL
  }

  if (daemon.version !== BRAND.version) {
    printVersionSkew(app, daemon.version)

    return LOCAL
  }

  // A daemon still starting refuses commands; running this one here would duplicate its work.
  if (!(await isReadyOrWaited(app, daemon.pid))) {
    return LOCAL
  }

  if ((await readApiDown(app)) !== undefined) {
    return LOCAL
  }

  const token = await readApiToken(app)

  return token.ok ? { kind: 'daemon', port: app.config.api.port, token: token.token } : LOCAL
}

async function isReadyOrWaited(app: CliApp, pid: number): Promise<boolean> {
  if (await isDaemonReady(app, pid)) {
    return true
  }

  app.err(hint(t(app.config.locale.language, 'cli.execWaitingForDaemon')))

  return await waitUntilDaemonReady(app, pid)
}

/** A daemon that predates the version field says nothing: there is no version to name. */
function printVersionSkew(app: CliApp, daemonVersion: string | undefined): void {
  if (daemonVersion === undefined) {
    return
  }

  app.err(
    warn(
      t(app.config.locale.language, 'cli.execVersionSkew', {
        daemon: daemonVersion,
        cli: BRAND.version,
        brand: BRAND.name,
      })
    )
  )
}

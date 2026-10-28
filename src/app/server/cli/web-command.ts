import type { SshAddress } from '@/app/server/cli/ssh-address'
import type { BrowserSignInCode } from '@/app/server/wire/sign-in'
import type { CliApp, Command } from '@/cli/api'
import type { MessageKey } from '@/i18n'
import { readApiToken } from '@/app/server/cli/api-token'
import { resolveSshAddress, toSshTarget } from '@/app/server/cli/ssh-address'
import { LOOPBACK_HOST } from '@/app/server/http/auth'
import { SIGN_IN_CODE_TTL_MS } from '@/app/server/http/sign-in-codes'
import { createCommand, fail, getEnv, hint } from '@/cli/api'
import { BRAND } from '@/core/brand'
import { isPlainRecord } from '@/core/utils/collections'
import { MS_PER_MINUTE } from '@/core/utils/time'
import { t } from '@/i18n'

const EXIT_FAILED = 1
const HTTP_UNAUTHORIZED = 401
// From loopback with the right Host, a 403 is the auth lockout after repeated wrong tries.
const HTTP_FORBIDDEN = 403
const CODE_REQUEST_TIMEOUT_MS = 5_000
// The tunnel's local end sits off the server's port, so it never lands on a daemon this machine
// runs on that same port.
const TUNNEL_PORT_OFFSET = 10_000
const MAX_PORT = 65_535
const REFUSED_CONNECT_CODES: ReadonlySet<string> = new Set(['ConnectionRefused', 'ECONNREFUSED'])

type CodeRequest =
  | { readonly ok: true; readonly code: BrowserSignInCode['code'] }
  | {
      readonly ok: false
      readonly key: Extract<
        MessageKey,
        'cli.webApiNotListening' | 'cli.webTokenRefused' | 'cli.webLockedOut' | 'cli.webCodeFailed'
      >
    }

/** Opens the office page signed in, through a one-time code the running daemon mints. */
export const webCommand: Command = createCommand({
  name: 'web',
  summary: { key: 'cliHelp.webSummary' },
  needs: { boot: false, daemon: 'running' },
  run: (_args, app) => openPage(app),
})

async function openPage(app: CliApp): Promise<number> {
  const locale = app.config.locale.language

  if (!app.config.api.enabled) {
    app.err(fail(t(locale, 'cli.webApiOff', { brand: BRAND.name })))

    return EXIT_FAILED
  }

  const read = await readApiToken(app)

  if (!read.ok) {
    app.err(fail(read.message))

    return EXIT_FAILED
  }

  const minted = await requestCode(app.config.api.port, read.token)

  if (!minted.ok) {
    app.err(fail(t(locale, minted.key, { brand: BRAND.name })))

    return EXIT_FAILED
  }

  printLink(app, minted.code)
  app.out(hint(t(locale, 'cli.webLinkNote', { minutes: SIGN_IN_CODE_TTL_MS / MS_PER_MINUTE })))

  return 0
}

async function requestCode(port: number, token: string): Promise<CodeRequest> {
  let res: Response

  try {
    res = await fetch(`http://${LOOPBACK_HOST}:${port}/v1/session/code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CODE_REQUEST_TIMEOUT_MS),
    })
  } catch (err: unknown) {
    return {
      ok: false,
      key: isConnectionRefused(err) ? 'cli.webApiNotListening' : 'cli.webCodeFailed',
    }
  }

  const body: unknown = await res.json().catch(() => undefined)

  if (res.status === HTTP_UNAUTHORIZED) {
    return { ok: false, key: 'cli.webTokenRefused' }
  }

  if (res.status === HTTP_FORBIDDEN) {
    return { ok: false, key: 'cli.webLockedOut' }
  }

  const code: unknown = res.ok && isPlainRecord(body) ? body.code : undefined

  return typeof code === 'string' && code !== ''
    ? { ok: true, code }
    : { ok: false, key: 'cli.webCodeFailed' }
}

function isConnectionRefused(err: unknown): boolean {
  return err instanceof Error && 'code' in err && REFUSED_CONNECT_CODES.has(String(err.code))
}

function printLink(app: CliApp, code: string): void {
  const { port, publicUrl } = app.config.api
  if (publicUrl !== undefined) {
    app.out(`${publicUrl}/#code=${code}`)

    return
  }

  const env = getEnv()
  const address = resolveSshAddress(env)

  if (address.overSsh) {
    printTunnel(app, address, code)

    return
  }

  const link = `http://${LOOPBACK_HOST}:${port}/#code=${code}`
  const opener = resolveBrowserOpener(env)

  if (opener === undefined) {
    app.out(link)

    return
  }

  app.out(t(app.config.locale.language, 'cli.webOpening'))
  app.out(link)
  openBrowser(opener, link)
}

function printTunnel(app: CliApp, address: SshAddress, code: string): void {
  const locale = app.config.locale.language
  const { port } = app.config.api
  const local =
    port + TUNNEL_PORT_OFFSET > MAX_PORT ? port - TUNNEL_PORT_OFFSET : port + TUNNEL_PORT_OFFSET
  const sshPort = address.port === undefined ? '' : ` -p ${address.port}`

  app.out(t(locale, 'cli.webTunnelRun'))
  app.out(
    `ssh -N -o ExitOnForwardFailure=yes -L ${local}:${LOOPBACK_HOST}:${port}${sshPort} ${toSshTarget(address.user, address.host)}`
  )
  app.out(t(locale, 'cli.webTunnelOpen'))
  app.out(`http://${LOOPBACK_HOST}:${local}/#code=${code}`)

  if (address.guessed) {
    app.out(hint(t(locale, 'cli.sshHostGuess', { host: address.host })))
  }
}

/** Only a desktop session has a browser to open; over SSH the page would open on the server. */
function resolveBrowserOpener(
  env: Readonly<Record<string, string | undefined>>
): string | undefined {
  if (process.platform === 'darwin') {
    return 'open'
  }

  const hasDisplay = (env.DISPLAY ?? '') !== '' || (env.WAYLAND_DISPLAY ?? '') !== ''

  return process.platform === 'linux' && hasDisplay ? 'xdg-open' : undefined
}

/** Fire and forget: the link is already printed, so a missing opener costs nothing. */
function openBrowser(opener: string, link: string): void {
  try {
    Bun.spawn([opener, link], { stdio: ['ignore', 'ignore', 'ignore'] }).unref()
  } catch {
    // The printed link is the fallback.
  }
}

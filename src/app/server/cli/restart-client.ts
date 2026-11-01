import type { RestartBody } from '@/app/server/wire/system'
import type { CliApp } from '@/cli/api'
import { readApiToken } from '@/app/server/cli/api-token'
import { LOOPBACK_HOST } from '@/app/server/http/auth'
import { RESTART_IDLE_WAIT_MS } from '@/app/update/restart'
import {
  canRestartInPlace,
  fail,
  hint,
  liveDaemon,
  readRestartFlags,
  success,
  waitForRestart,
} from '@/cli/api'
import { BRAND } from '@/core/brand'
import { isPlainRecord } from '@/core/utils/collections'
import { t } from '@/i18n'

const EXIT_FAILED = 1
const HTTP_ACCEPTED = 202
const HTTP_CONFLICT = 409
const REQUEST_TIMEOUT_MS = 5_000

/** Asks the running daemon to restart in place, for `restart` before it boots. Undefined means the
 *  daemon was not asked, and `restart` goes on to stop it and start again here: there is none, the
 *  operator wants a fresh start (`--background`), or it cannot be reached. */
export async function restartRunningDaemon(
  app: CliApp,
  argv: readonly string[]
): Promise<number | undefined> {
  const flags = readRestartFlags(argv)

  if (flags.background || !canRestartInPlace() || !app.config.api.enabled) {
    return undefined
  }

  const daemon = await liveDaemon(app)
  const token = await readApiToken(app)

  if (daemon === null || !token.ok) {
    return undefined
  }

  return await restartDaemonWith(app, daemon, {
    token: token.token,
    when: flags.now ? 'now' : 'idle',
  })
}

interface RestartAsk {
  readonly token: string
  readonly when: RestartBody['when']
}

/** Asks the running daemon, through the token it holds, to restart in place and waits for it to come
 *  back. Undefined means it could not be asked: nothing listens, or it does not take this token. */
export async function restartDaemonWith(
  app: CliApp,
  daemon: { readonly startedAt?: number },
  ask: RestartAsk
): Promise<number | undefined> {
  const { token, when } = ask
  const answer = await requestRestart(app.config.api.port, token, when)

  if (answer === undefined) {
    return undefined
  }

  const locale = app.config.locale.language

  if (answer.kind === 'refused') {
    app.err(fail(answer.message ?? t(locale, 'cli.daemonRestartRefused', { brand: BRAND.name })))

    return EXIT_FAILED
  }

  app.out(hint(t(locale, 'cli.daemonRestartAsked')))

  const idleMs = when === 'idle' ? RESTART_IDLE_WAIT_MS : 0
  const restarted = await waitForRestart(app, daemon, idleMs)

  if (restarted === undefined) {
    app.err(fail(t(locale, 'cli.daemonRestartTimeout', { brand: BRAND.name })))

    return EXIT_FAILED
  }

  app.out(
    success(
      t(locale, 'cli.daemonRestarted', {
        version: restarted.version ?? BRAND.version,
        pid: restarted.pid,
      })
    )
  )

  return 0
}

type RestartAnswer =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refused'; readonly message?: string }

/** The daemon's answer, or undefined when it cannot be asked: nothing listens, or it does not take
 *  this token, so a restart from here is the way to bring them together. */
async function requestRestart(
  port: number,
  token: string,
  when: RestartBody['when']
): Promise<RestartAnswer | undefined> {
  let res: Response

  try {
    res = await fetch(`http://${LOOPBACK_HOST}:${port}/v1/restart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ when } satisfies RestartBody),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch {
    return undefined
  }

  if (res.status === HTTP_ACCEPTED) {
    return { kind: 'accepted' }
  }

  if (res.status !== HTTP_CONFLICT) {
    return undefined
  }

  const body: unknown = await res.json().catch(() => undefined)
  const message = isPlainRecord(body) && isPlainRecord(body.error) ? body.error.message : undefined

  return typeof message === 'string' ? { kind: 'refused', message } : { kind: 'refused' }
}

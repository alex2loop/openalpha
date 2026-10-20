import { link, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { CliApp } from '@/cli/types'
import type { MessageKey } from '@/i18n'
import { isBackgroundLaunch } from '@/cli/daemon-env'
import { readyFilePath } from '@/cli/daemon-ready'
import { getEnv } from '@/cli/env'
import { fail, hint } from '@/cli/ui/colors'
import { BRAND } from '@/core/brand'
import { OperatorConfigError } from '@/core/config/resolve'
import { ConfigError, isErrno } from '@/core/errors'
import { isPlainRecord } from '@/core/utils/collections'
import { t } from '@/i18n'

const PID_FILE_MODE = 0o600
// Retry covers stale-pid cleanup races: another daemon can win the link between our read and
// our unlink. Bounded by the loop; in practice it resolves on the 2nd attempt.
const PID_LOCK_MAX_ATTEMPTS = 3
const STOP_POLL_MS = 500
// ps prints lstart in the caller's locale; the daemon (launchd/systemd) and the CLI must agree.
const IDENTITY_ENV = { LC_ALL: 'C' } as const
// Between the start time and the image path in a Windows identity; the ISO time has no space.
const IDENTITY_SEPARATOR = ' '

interface ProcessIdentity {
  readonly pid: number
  readonly started: string
  // Absent from a pid file written by a daemon that predates it; that daemon is still live.
  readonly version?: string
  // Absent from a pid file written before upgrade could restart a daemon; absent reads as foreground.
  readonly background?: boolean
  // The config file the daemon loaded, so a restart reads the same one from any directory.
  readonly configPath?: string
  // When this run began (epoch ms), so an unclean stop can name its start time. Absent from a pid
  // file written before it was recorded.
  readonly startedAt?: number
}

/** `stale` is the file a reclaim removed, kept so a start that fails can put it back. */
export type PidFileClaim =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'reclaimed'; readonly stale: string; readonly startedAt?: number }

export type RunningDaemon = Pick<ProcessIdentity, 'pid' | 'version' | 'background' | 'configPath'>

type PidFileState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'pid'; readonly identity: ProcessIdentity }

function pidFilePath(app: CliApp): string {
  return join(app.config.paths.dataDir, BRAND.pidFile)
}

function stopFilePath(app: CliApp): string {
  return join(app.config.paths.dataDir, BRAND.stopFile)
}

export async function liveDaemonPid(app: CliApp): Promise<number | null> {
  return (await liveDaemon(app))?.pid ?? null
}

export async function liveDaemon(app: CliApp): Promise<RunningDaemon | null> {
  const state = await readPidState(pidFilePath(app))

  if (state.kind !== 'pid') {
    return null
  }

  return (await identityState(state.identity)) === 'match' ? state.identity : null
}

/** A pid file whose process is gone: the daemon died without stopping cleanly (a clean stop removes
 *  the file). Null when there is none, or when the process is still there to be asked. */
export async function readStalePid(app: CliApp): Promise<{ readonly startedAt?: number } | null> {
  const state = await readPidState(pidFilePath(app))

  if (state.kind !== 'pid' || (await identityState(state.identity)) !== 'mismatch') {
    return null
  }

  return state.identity.startedAt === undefined ? {} : { startedAt: state.identity.startedAt }
}

export async function inspectDaemon(
  app: CliApp
): Promise<'absent' | 'live' | 'stale' | 'malformed' | 'unreadable'> {
  const state = await readPidState(pidFilePath(app))

  if (state.kind === 'absent' || state.kind === 'unreadable' || state.kind === 'malformed') {
    return state.kind
  }

  const identity = await identityState(state.identity)

  if (identity === 'match') {
    return 'live'
  }

  return identity === 'mismatch' ? 'stale' : 'unreadable'
}

// invariant: the pid file appears whole via link(2), which fails if one exists, so two daemons can
// never both believe they hold it and no reader sees a half-written file.
export async function writePidFile(app: CliApp, pid: number): Promise<PidFileClaim> {
  const pidPath = pidFilePath(app)
  const started = await readProcessIdentity(pid)

  if (started === null) {
    throw new ConfigError('cannot read daemon process identity')
  }

  const identity = {
    pid,
    started,
    version: BRAND.version,
    background: isBackgroundLaunch(),
    configPath: app.configPath,
    startedAt: Date.now(),
  }
  let claim: PidFileClaim = { kind: 'fresh' }

  for (let attempt = 0; attempt < PID_LOCK_MAX_ATTEMPTS; attempt++) {
    if (await tryCreatePidFile(pidPath, identity)) {
      return claim
    }

    let raw: string

    try {
      raw = await readFile(pidPath, 'utf8')
    } catch (err: unknown) {
      if (isErrno(err, 'ENOENT')) {
        continue
      }

      throw err
    }

    const claimed = await claimStalePidFile(pidPath, raw)

    if (claimed.kind === 'reclaimed') {
      claim = claimed
    }

    if (claimed.kind === 'live') {
      const owner = String(parseProcessIdentity(raw)?.pid ?? raw.trim())

      throw new OperatorConfigError(`daemon already running (pid ${owner})`, {
        key: 'errors.daemonAlreadyRunning',
        params: { pid: owner },
      })
    }
  }

  throw new OperatorConfigError(`unable to acquire pid file after retries: ${pidPath}`, {
    key: 'errors.setupPathUnusable',
    params: { path: pidPath },
  })
}

async function tryCreatePidFile(pidPath: string, identity: ProcessIdentity): Promise<boolean> {
  const draftPath = `${pidPath}.${process.pid}.tmp`

  try {
    await writeFile(draftPath, JSON.stringify(identity), { mode: PID_FILE_MODE })
    await link(draftPath, pidPath)

    return true
  } catch (err: unknown) {
    if (isErrno(err, 'EEXIST')) {
      return false
    }

    throw err
  } finally {
    await rm(draftPath, { force: true }).catch(() => undefined)
  }
}

// 'retry': the file is gone (another reader removed it, it changed, or it named no run and we removed
// it) - try the create again. 'reclaimed': we removed a stale file, which is how an unclean stop
// shows. 'live': the pid names a running daemon and the caller must give up.
type StaleClaim =
  | { readonly kind: 'retry' }
  | { readonly kind: 'live' }
  | { readonly kind: 'reclaimed'; readonly stale: string; readonly startedAt?: number }

async function claimStalePidFile(pidPath: string, raw: string): Promise<StaleClaim> {
  const identity = parseProcessIdentity(raw)

  if (identity !== null) {
    const state = await identityState(identity)

    if (state === 'match' || state === 'unknown') {
      return { kind: 'live' }
    }
  }

  // Re-read before unlinking: a daemon that won 'wx' between our read and our unlink would
  // otherwise have its valid pid file deleted by us. This narrows the race to one syscall pair;
  // closing it fully needs flock(2)/fcntl(2), which has no portable binding here.
  try {
    const current = await readFile(pidPath, 'utf8')

    if (current.trim() !== raw.trim()) {
      return { kind: 'retry' }
    }

    await unlink(pidPath)
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return { kind: 'retry' }
    }

    throw err
  }

  // A file that names no run (empty, cut short) shows no crash.
  if (identity === null) {
    return { kind: 'retry' }
  }

  return identity.startedAt === undefined
    ? { kind: 'reclaimed', stale: raw }
    : { kind: 'reclaimed', stale: raw, startedAt: identity.startedAt }
}

/** Puts back a pid file a reclaim removed; false when it could not or another start holds the path. */
export async function restoreStalePidFile(app: CliApp, stale: string): Promise<boolean> {
  try {
    await writeFile(pidFilePath(app), stale, { mode: PID_FILE_MODE, flag: 'wx' })

    return true
  } catch {
    // The caller logs it: a failed restore costs one notice.
    return false
  }
}

export async function removePidFile(app: CliApp): Promise<boolean> {
  // A leftover stop or ready file is harmless: it names a pid no later daemon has.
  await rm(stopFilePath(app), { force: true }).catch(() => undefined)
  await rm(readyFilePath(app), { force: true }).catch(() => undefined)

  try {
    await unlink(pidFilePath(app))

    return true
  } catch (err: unknown) {
    return isErrno(err, 'ENOENT')
  }
}

// `stop` recovery: a malformed file names no process, so no live daemon can own it (a starting
// daemon publishes its file whole). Routed through claimStalePidFile for the same
// re-read-before-unlink race guard as the start path.
export async function clearMalformedPidFile(app: CliApp): Promise<boolean> {
  const pidPath = pidFilePath(app)

  if ((await readPidState(pidPath)).kind !== 'malformed') {
    return false
  }

  let raw: string

  try {
    raw = await readFile(pidPath, 'utf8')
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return true
    }

    throw err
  }

  return (await claimStalePidFile(pidPath, raw)).kind !== 'live'
}

/** Why the pid file cannot be cleared out of the way. `unreadable` also covers a live daemon whose
 *  pid vanished between the two reads: the file is there and something may still hold it. */
const UNCLEARABLE_PID_FILE_KEYS: Readonly<Record<'unreadable' | 'malformed', MessageKey>> =
  Object.freeze({
    unreadable: 'cli.daemonPidFileUnreadable',
    malformed: 'cli.daemonPidFileMalformed',
  })

type WhenRunning = 'stop-first' | 'already-started'

const WHEN_RUNNING_HINT_KEYS: Readonly<Record<WhenRunning, MessageKey>> = Object.freeze({
  'stop-first': 'cli.daemonStopFirst',
  'already-started': 'cli.daemonAlreadyStartedHint',
})

export async function isDaemonStopped(app: CliApp, whenRunning: WhenRunning): Promise<boolean> {
  const locale = app.config.locale.language
  const params = { brand: BRAND.name }
  const state = await inspectDaemon(app)

  if (state === 'live') {
    const pid = await liveDaemonPid(app)
    const running =
      pid === null
        ? t(locale, UNCLEARABLE_PID_FILE_KEYS.unreadable)
        : t(locale, 'cli.daemonAlreadyRunning', { pid })

    app.err(fail(running))
    app.err(hint(t(locale, WHEN_RUNNING_HINT_KEYS[whenRunning], params)))

    return false
  }

  if (state === 'unreadable' || state === 'malformed') {
    // Whether a daemon runs is unknown here, so only the stop that clears the doubt is offered.
    app.err(fail(t(locale, UNCLEARABLE_PID_FILE_KEYS[state])))
    app.err(hint(t(locale, 'cli.daemonStopFirst', params)))

    return false
  }

  return true
}

export async function isDaemonRunning(app: CliApp): Promise<boolean> {
  if ((await liveDaemonPid(app)) !== null) {
    return true
  }

  const locale = app.config.locale.language

  app.err(fail(t(locale, 'cli.daemonRequiredNotRunning')))
  app.err(hint(t(locale, 'cli.daemonStartFirst', { brand: BRAND.name })))

  return false
}

/** Windows gives a process no SIGTERM it can handle, so `stop` there writes the daemon's pid to a
 *  file the daemon polls. */
export async function requestDaemonStop(app: CliApp, pid: number): Promise<void> {
  if (process.platform === 'win32') {
    await writeFile(stopFilePath(app), String(pid))

    return
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch (err: unknown) {
    // ESRCH: the daemon exited between the pid check and the signal, so it is already stopped.
    if (!isErrno(err, 'ESRCH')) {
      throw err
    }
  }
}

/** Only a request naming this process stops it, so a file a dead daemon never read is ignored. */
export function watchStopRequest(app: CliApp, onStop: () => void): () => void {
  if (process.platform !== 'win32') {
    return () => undefined
  }

  const path = stopFilePath(app)
  const ownPid = String(process.pid)
  const timer = setInterval(() => {
    readFile(path, 'utf8').then(
      (raw) => (raw.trim() === ownPid ? onStop() : undefined),
      () => undefined
    )
  }, STOP_POLL_MS)

  return () => clearInterval(timer)
}

async function readPidState(pidPath: string): Promise<PidFileState> {
  let raw: string

  try {
    raw = await readFile(pidPath, 'utf8')
  } catch (err: unknown) {
    return isErrno(err, 'ENOENT') ? { kind: 'absent' } : { kind: 'unreadable' }
  }

  const identity = parseProcessIdentity(raw)

  return identity === null ? { kind: 'malformed' } : { kind: 'pid', identity }
}

function parseProcessIdentity(raw: string): ProcessIdentity | null {
  let value: unknown

  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }

  if (!isPlainRecord(value)) {
    return null
  }

  const { pid, started, version, background, configPath, startedAt } = value

  if (
    !Number.isSafeInteger(pid) ||
    Number(pid) <= 0 ||
    typeof started !== 'string' ||
    started === ''
  ) {
    return null
  }

  return {
    pid: Number(pid),
    started,
    ...(typeof version === 'string' && version !== '' ? { version } : {}),
    ...(typeof background === 'boolean' ? { background } : {}),
    ...(typeof configPath === 'string' && configPath !== '' ? { configPath } : {}),
    ...(Number.isSafeInteger(startedAt) && Number(startedAt) > 0
      ? { startedAt: Number(startedAt) }
      : {}),
  }
}

async function identityState(identity: ProcessIdentity): Promise<'match' | 'mismatch' | 'unknown'> {
  try {
    process.kill(identity.pid, 0)
  } catch (err: unknown) {
    if (isErrno(err, 'ESRCH')) {
      return 'mismatch'
    }

    return 'unknown'
  }

  const current = await readProcessIdentity(identity.pid)

  if (current === null) {
    return 'unknown'
  }

  return isSameStart(current, identity.started) ? 'match' : 'mismatch'
}

/** On Windows the recorded identity is the start time and then the image path, and the install
 *  script renames a running exe aside, so the path may differ from the one recorded. The start time,
 *  to the tick, still tells this daemon from a process that reused its pid. */
function isSameStart(current: string, recorded: string): boolean {
  if (process.platform !== 'win32') {
    return current === recorded
  }

  return startTimeOf(current) === startTimeOf(recorded)
}

function startTimeOf(identity: string): string {
  return identity.split(IDENTITY_SEPARATOR, 1)[0] ?? ''
}

/** Start time plus command line: together they tell this daemon from a later process that reused
 *  its pid. */
function processIdentityCommand(pid: number): string[] {
  if (process.platform === 'win32') {
    const query = `$p = Get-Process -Id ${pid} -ErrorAction Stop; "$($p.StartTime.ToString('o')) $($p.Path)"`

    return ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', query]
  }

  return ['ps', '-p', String(pid), '-o', 'lstart=,args=']
}

async function readProcessIdentity(pid: number): Promise<string | null> {
  try {
    const proc = Bun.spawn(processIdentityCommand(pid), {
      stdout: 'pipe',
      stderr: 'ignore',
      env: { ...getEnv(), ...IDENTITY_ENV },
      windowsHide: true,
    })

    if ((await proc.exited) !== 0) {
      return null
    }

    const identity = (await new Response(proc.stdout).text()).trim()

    return identity === '' ? null : identity
  } catch {
    return null
  }
}

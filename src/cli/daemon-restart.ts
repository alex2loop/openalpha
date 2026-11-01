import { resolveSelfCommand } from '@/cli/services'

/** SIGHUP is a terminal closing, so the operator's restart is this one: `kill -USR2 <pid>`. */
export const RESTART_SIGNAL = 'SIGUSR2'

let requested = false

/** Windows has no execve, and Bun before 1.3.14 has no `process.execve`. */
export function canRestartInPlace(): boolean {
  return process.platform !== 'win32' && typeof process.execve === 'function'
}

export function requestRestartInPlace(): void {
  requested = true
}

export function isRestartRequested(): boolean {
  return requested
}

/** Replaces this process with the command line it started with: same pid, terminal and descriptors
 *  0 to 2, every other descriptor closed. Nothing runs after it, so everything is closed before. It
 *  throws when the new image cannot start, and this process carries on as it was. */
export function execSelf(env: Readonly<Record<string, string>>): void {
  const { command, args } = resolveSelfCommand()

  process.execve?.(command, [command, ...args, ...process.argv.slice(2)], { ...env })
}

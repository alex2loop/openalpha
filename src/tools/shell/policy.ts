import { basename, resolve as resolvePath } from 'node:path'

import { ToolError } from '@/core/errors'

const BLOCKED_FILESYSTEM_RE = /^(?:format|mkfs(?:\.[a-z0-9_-]+)?)$/
const BLOCKED_INTERPRETER_RE =
  /^(?:(?:python|ruby|perl|php|lua|luajit|tclsh|pypy|pypy3)(?:\d+(?:\.\d+)*)?|node(?:js)?|deno|[gmna]?awk|nc|ncat|netcat|socat|bun|osascript|rscript|r|rterm|jshell|julia|irb|iex|swift|php-cgi)$/
// Commands whose argv hides what actually runs: shells, process wrappers, package runners that
// fetch and execute a name, remote/scheduled execution, and interactive tools whose shell escape is
// their only use here (stdin is closed, so they can do nothing else). Approval remains the control
// that matters; this list keeps a disguised shell from reading as an innocuous call in the prompt.
// Deliberately absent: git, find, sed, tar, make, rsync, wget and friends — each has an escape
// hatch, but it is spelled out in the argv the operator approves, and blocking them would take the
// tool's legitimate use with it.
const BLOCKED_COMMAND_LAUNCHERS: ReadonlySet<string> = new Set([
  'at',
  'bash',
  'bunx',
  'busybox',
  'chroot',
  'crontab',
  'csh',
  'dash',
  'doas',
  'emacs',
  'env',
  'ex',
  'expect',
  'fish',
  'flock',
  'gdb',
  'ionice',
  'ksh',
  'less',
  'ltrace',
  'man',
  'mksh',
  'more',
  'nice',
  'nohup',
  'npx',
  'nsenter',
  'parallel',
  'pnpx',
  'prlimit',
  'runuser',
  'screen',
  'scp',
  'setpriv',
  'setsid',
  'sh',
  'ssh',
  'stdbuf',
  'strace',
  'su',
  'sudo',
  'systemd-run',
  'taskset',
  'tcsh',
  'time',
  'timeout',
  'tmux',
  'unshare',
  'vi',
  'vim',
  'watch',
  'xargs',
  'zsh',
])
const DD_RAW_DEVICE_RE = /\bof=\/dev\//
const RM_FORCE_RE = /^-[a-zA-Z]*f/
const ROOT_OPERAND_RE = /^\//

const EXIT_CODE_MEANINGS: Readonly<Record<string, Readonly<Record<number, string>>>> =
  Object.freeze({
    grep: Object.freeze({ 1: 'No matches found', 2: 'Invalid arguments or file not found' }),
    diff: Object.freeze({ 1: 'Files differ', 2: 'Trouble with input files' }),
    curl: Object.freeze({
      6: 'Could not resolve host',
      7: 'Failed to connect',
      22: 'HTTP error (4xx/5xx)',
      28: 'Operation timeout',
    }),
    git: Object.freeze({ 1: 'Often normal (e.g. no changes, merge conflicts)' }),
  })

export function assertCommandAllowed(command: string, args: readonly string[]): void {
  const base = basename(command).toLowerCase()

  if (BLOCKED_COMMAND_LAUNCHERS.has(base)) {
    throw new ToolError('invalid_input', `command launcher blocked: ${base}`)
  }

  if (BLOCKED_INTERPRETER_RE.test(base)) {
    throw new ToolError('invalid_input', `command interpreter blocked: ${base}`)
  }

  if (BLOCKED_FILESYSTEM_RE.test(base)) {
    throw new ToolError('invalid_input', `command blocked: ${base}`)
  }

  if (base === 'rm' && isRootRemoval(args)) {
    throw new ToolError('invalid_input', 'rm of the filesystem root is not allowed')
  }

  if (base === 'dd' && args.some((arg) => DD_RAW_DEVICE_RE.test(arg))) {
    throw new ToolError('invalid_input', 'dd to a raw device is not allowed')
  }
}

export function interpretExitCode(command: string, exitCode: number): string | null {
  if (exitCode === 0) {
    return null
  }

  const meanings = EXIT_CODE_MEANINGS[basename(command).toLowerCase()]
  return meanings?.[exitCode] ?? null
}

function isRootRemoval(args: readonly string[]): boolean {
  const force = args.some(
    (arg) => RM_FORCE_RE.test(arg) || arg === '--no-preserve-root' || arg === '--force'
  )

  if (!force) {
    return false
  }

  return args.some((arg) => ROOT_OPERAND_RE.test(arg) && resolvePath(arg) === '/')
}

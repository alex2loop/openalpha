import type { Stats } from 'node:fs'
import {
  close,
  closeSync,
  constants,
  fchmod,
  fchmodSync,
  fstat,
  fstatSync,
  lstat,
  lstatSync,
  mkdirSync,
  open,
  openSync,
  readdir,
  readdirSync,
  realpath,
  realpathSync,
  unlink,
} from 'node:fs'
import { basename, dirname, join, resolve as resolvePath } from 'node:path'

import { ConfigError, isErrno } from '@/core/errors'
import { isLogSegmentName } from '@/core/logging/paths'

const LOG_FILE_MODE = 0o600
const LOG_DIR_MODE = 0o700
const FIRST_SEGMENT = 1

export interface SegmentState {
  fd: number
  number: number
  size: number
}

export interface LogQueueState {
  readonly pendingRecords: number
  readonly pendingBytes: number
}

export interface LogDestinationHooks {
  readonly beforePruneUnlink?: (path: string) => void
  readonly onFdClose?: (fd: number) => void
  readonly onQueueChange?: (state: LogQueueState) => void
  readonly open?: (
    path: string,
    flags: number,
    mode: number,
    callback: (err: NodeJS.ErrnoException | null, fd: number) => void
  ) => void
  readonly write?: (
    fd: number,
    buffer: Buffer,
    offset: number,
    callback: (err: NodeJS.ErrnoException | null, bytesWritten: number) => void
  ) => void
}

interface PruneOptions {
  readonly parent: string
  readonly base: string
  readonly current: number
  readonly maxRetained: number
  readonly parentRealpath: string
  readonly generation: number
  readonly isCurrent: (generation: number) => boolean
  readonly hooks?: LogDestinationHooks
}

// The part of the path that already exists is the operator's: it is resolved (a symlinked /tmp or
// home is ordinary) and left untouched, and inspection judges its owner and mode. Only the
// directories created here are born private, so none is ever symlinked or chmodded by this call.
export function preparePrivateParent(rawParent: string): string {
  const parent = resolvePath(rawParent)
  const missing: string[] = []
  let anchor = parent

  while (!pathExists(anchor)) {
    missing.unshift(basename(anchor))
    anchor = dirname(anchor)
  }

  if (missing.length === 0) {
    assertRealDirectory(parent)
  }

  let current = realpathSync(anchor)

  for (const component of missing) {
    current = join(current, component)
    mkdirSync(current, { mode: LOG_DIR_MODE })
  }

  return current
}

export function secureSegments(parent: string, base: string): readonly number[] {
  const numbers: number[] = []

  for (const name of readdirSync(parent)) {
    if (!name.startsWith(`${base}.`)) {
      continue
    }

    if (!isLogSegmentName(base, name)) {
      // A stray sibling (backup, editor swap file) must not stop the daemon from starting; only a
      // name that matches the segment shape but fails the identity check below still throws.
      continue
    }

    const fd = openExistingSegment(join(parent, name), constants.O_RDWR | constants.O_APPEND)

    try {
      assertOpenFdSync(fd)
    } finally {
      closeFd(fd)
    }

    numbers.push(Number(name.slice(base.length + 1)))
  }

  return numbers.sort((left, right) => left - right)
}

export function openInitialSegment(
  parent: string,
  base: string,
  segments: readonly number[]
): SegmentState {
  const number = segments.at(-1) ?? FIRST_SEGMENT
  const path = segmentPath(parent, base, number)
  const fd =
    segments.length === 0
      ? openNewSegmentSync(path)
      : openExistingSegment(path, constants.O_WRONLY | constants.O_APPEND)

  try {
    assertOpenFdSync(fd)

    return { fd, number, size: fstatSync(fd).size }
  } catch (err: unknown) {
    closeFd(fd)
    throw err
  }
}

export function assertOpenFd(
  fd: number,
  generation: number,
  isCurrent: (generation: number) => boolean
): Promise<void> {
  if (!isCurrent(generation)) {
    return Promise.reject(new ConfigError('log destination closed before segment validation'))
  }

  return new Promise((resolve, reject) => {
    fstat(fd, (statErr, stat) => {
      if (statErr !== null) {
        reject(statErr)
        return
      }

      if (!(isCurrent(generation) && stat.isFile())) {
        reject(new ConfigError('log segment is no longer current and regular'))
        return
      }

      fchmod(fd, LOG_FILE_MODE, (chmodErr) => {
        if (chmodErr !== null || !isCurrent(generation)) {
          reject(chmodErr ?? new ConfigError('log destination closed during chmod'))
          return
        }

        resolve()
      })
    })
  })
}

export async function assertParentIdentity(
  parent: string,
  expectedRealpath: string
): Promise<void> {
  const stat = await statPath(parent)
  const resolved = await realPath(parent)

  if (stat.isSymbolicLink() || !stat.isDirectory() || resolved !== expectedRealpath) {
    throw new ConfigError('log parent changed after startup')
  }
}

export async function pruneSegments(options: PruneOptions): Promise<void> {
  const names = await readDirectory(options.parent)
  const numbers = segmentNumbers(names, options.base).filter((number) => number !== options.current)

  for (const number of numbers.slice(0, Math.max(0, numbers.length - options.maxRetained))) {
    if (!options.isCurrent(options.generation)) {
      return
    }

    await assertParentIdentity(options.parent, options.parentRealpath)

    if (!options.isCurrent(options.generation)) {
      return
    }

    await unlinkStableSegment(options, number)
  }
}

export function segmentPath(parent: string, base: string, number: number): string {
  const name = `${base}.${number}`

  if (!isLogSegmentName(base, name)) {
    throw new ConfigError('invalid generated log segment name')
  }

  return join(parent, name)
}

export function closeFdAsync(fd: number): Promise<void> {
  return new Promise((resolve) => {
    close(fd, () => resolve())
  })
}

export function closeFd(fd: number): void {
  try {
    closeSync(fd)
  } catch {
    // Numeric fd ownership is idempotently released at this boundary.
  }
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path)

    return true
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return false
    }

    throw err
  }
}

function assertRealDirectory(path: string): void {
  const stat = lstatSync(path)

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ConfigError('log path components must be real directories')
  }
}

function openNewSegmentSync(path: string): number {
  return openSync(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_APPEND |
      constants.O_WRONLY |
      constants.O_NOFOLLOW,
    LOG_FILE_MODE
  )
}

function openExistingSegment(path: string, access: number): number {
  return openSync(path, access | constants.O_NOFOLLOW)
}

function assertOpenFdSync(fd: number): void {
  if (!fstatSync(fd).isFile()) {
    throw new ConfigError('log segment must be a regular file')
  }

  fchmodSync(fd, LOG_FILE_MODE)
}

export interface StableFileIdentity {
  readonly dev: number
  readonly ino: number
}

export async function unlinkStableFile(path: string, expected?: StableFileIdentity): Promise<void> {
  const fd = await openFd(path, constants.O_RDONLY | constants.O_NOFOLLOW, 0)

  try {
    const opened = await statFd(fd)
    const current = await statPath(path)

    if (
      !opened.isFile() ||
      current.isSymbolicLink() ||
      !current.isFile() ||
      opened.dev !== current.dev ||
      opened.ino !== current.ino
    ) {
      throw new ConfigError('log file changed before retention cleanup')
    }

    if (expected !== undefined && (opened.dev !== expected.dev || opened.ino !== expected.ino)) {
      throw new ConfigError('log file identity changed before retention cleanup')
    }

    await unlinkPath(path)
  } finally {
    await closeFdAsync(fd)
  }
}

async function unlinkStableSegment(options: PruneOptions, number: number): Promise<void> {
  if (!options.isCurrent(options.generation)) {
    return
  }

  const path = segmentPath(options.parent, options.base, number)

  if (!options.isCurrent(options.generation)) {
    return
  }

  await assertParentIdentity(options.parent, options.parentRealpath)

  if (!options.isCurrent(options.generation)) {
    return
  }

  options.hooks?.beforePruneUnlink?.(path)
  await unlinkStableFile(path)
}

function segmentNumbers(names: readonly string[], base: string): readonly number[] {
  const numbers: number[] = []

  for (const name of names) {
    if (!name.startsWith(`${base}.`)) {
      continue
    }

    if (!isLogSegmentName(base, name)) {
      // Pruning is best-effort maintenance; a stray sibling is not a reason to fail the write path
      // that triggered it.
      continue
    }

    numbers.push(Number(name.slice(base.length + 1)))
  }

  return numbers.sort((left, right) => left - right)
}

function readDirectory(path: string): Promise<readonly string[]> {
  return new Promise((resolve, reject) => {
    readdir(path, (err, names) => (err === null ? resolve(names) : reject(err)))
  })
}

function openFd(path: string, flags: number, mode: number): Promise<number> {
  return new Promise((resolve, reject) => {
    open(path, flags, mode, (err, fd) => (err === null ? resolve(fd) : reject(err)))
  })
}

function statFd(fd: number): Promise<Stats> {
  return new Promise((resolve, reject) => {
    fstat(fd, (err, stat) => {
      if (err !== null) {
        reject(err)
        return
      }

      if (stat === undefined) {
        reject(new ConfigError('log segment stat returned no result'))
        return
      }

      resolve(stat)
    })
  })
}

function statPath(path: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    lstat(path, (err, stat) => {
      if (err !== null) {
        reject(err)
        return
      }

      if (stat === undefined) {
        reject(new ConfigError('log segment path stat returned no result'))
        return
      }

      resolve(stat)
    })
  })
}

function realPath(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    realpath(path, (err, resolved) => (err === null ? resolve(resolved) : reject(err)))
  })
}

function unlinkPath(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    unlink(path, (err) => (err === null ? resolve() : reject(err)))
  })
}

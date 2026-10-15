import { constants, fstatSync, lstatSync, openSync, readdirSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'

import { OperatorConfigError } from '@/core/config/operator-errors'
import { ConfigError, isErrno } from '@/core/errors'
import { closeFd } from '@/core/logging/files'
import { isLogSegmentName } from '@/core/logging/paths'
import { HAS_DIRECTORY_MODES } from '@/core/security/private-files'

const OTHERS_WRITE_MASK = 0o022

export function inspectLogDestination(file: string): void {
  assertAbsoluteLogPath(file)

  const parent = dirname(file)
  const base = basename(file)

  assertExistingPrivateLogParent(parent)
  inspectOptionalRegularFile(file, 'log destination must be a regular file')
  inspectRotatedSegments(parent, base)
}

function assertAbsoluteLogPath(file: string): void {
  if (!isAbsolute(file)) {
    throw new ConfigError('resolved log destination must be absolute')
  }
}

function assertExistingPrivateLogParent(parent: string): void {
  const stat = readPathInfo(parent, 'cannot inspect log parent')
  const uid = process.getuid?.()

  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new OperatorConfigError('log parent must be a real directory', {
      key: 'errors.logDirUnsafe',
      params: { path: parent },
    })
  }

  if (uid !== undefined && stat.uid !== uid) {
    throw new OperatorConfigError('existing log parent must be owned by the current user', {
      key: 'errors.logDirUnsafe',
      params: { path: parent },
    })
  }

  // Segments are 0600, so a readable folder leaks nothing; a writable one lets another user swap
  // or remove them. An existing folder (a home directory) is never chmodded to make this pass.
  if (HAS_DIRECTORY_MODES && (stat.mode & OTHERS_WRITE_MASK) !== 0) {
    throw new OperatorConfigError('existing log parent must not be group- or world-writable', {
      key: 'errors.logDirUnsafe',
      params: { path: parent },
    })
  }
}

function inspectOptionalRegularFile(path: string, errorMessage: string): void {
  try {
    inspectExistingRegularFile(path, errorMessage)
  } catch (err: unknown) {
    if (isMissingLogPath(err)) {
      return
    }

    throw err
  }
}

function inspectRotatedSegments(parent: string, base: string): void {
  const names = readDirectory(parent)

  for (const name of names) {
    if (!name.startsWith(`${base}.`)) {
      continue
    }

    if (!isLogSegmentName(base, name)) {
      // A stray sibling (rotation backup, editor swap file) must not stop the daemon from starting.
      // Same policy as `secureSegments` and retention's scan — one situation, one answer.
      continue
    }

    inspectExistingRegularFile(join(parent, name), 'log segment must be a regular file')
  }
}

function inspectExistingRegularFile(path: string, errorMessage: string): void {
  const pathInfo = readPathInfo(path, 'cannot inspect log destination')

  if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
    throw new ConfigError(errorMessage)
  }

  let fd: number | undefined

  try {
    fd = openReadOnly(path, 'cannot inspect log destination')
    const opened = readOpenedPathInfo(fd)

    if (!opened.isFile()) {
      throw new ConfigError(errorMessage)
    }
  } finally {
    if (fd !== undefined) {
      closeFd(fd)
    }
  }
}

function readDirectory(parent: string): readonly string[] {
  try {
    return readdirSync(parent)
  } catch (err: unknown) {
    throw new ConfigError('cannot inspect log parent', err)
  }
}

function readPathInfo(path: string, message: string) {
  try {
    return lstatSync(path)
  } catch (err: unknown) {
    throw new ConfigError(message, err)
  }
}

function openReadOnly(path: string, message: string): number {
  try {
    return openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (err: unknown) {
    throw new ConfigError(message, err)
  }
}

function readOpenedPathInfo(fd: number) {
  try {
    return fstatSync(fd)
  } catch (err: unknown) {
    throw new ConfigError('cannot inspect log destination', err)
  }
}

export function isMissingLogPath(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false
  }

  if (isErrno(err, 'ENOENT')) {
    return true
  }

  return err instanceof ConfigError && isMissingLogPath(err.cause)
}

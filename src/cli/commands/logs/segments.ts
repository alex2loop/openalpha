import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { ConfigError, isErrno } from '@/core/errors'
import { isLogSegmentName } from '@/core/logging/paths'

const MAX_LOG_SEGMENTS = 128
const MAX_LOG_SCAN_BYTES = 512 * 1024 * 1024
const MAX_SEGMENT_SNAPSHOT_RETRIES = 2

export interface LogSegment {
  readonly path: string
  readonly number: number
  readonly dev: number
  readonly ino: number
  readonly size: number
}

interface LogParentIdentity {
  readonly path: string
  readonly canonical: string
  readonly dev: number
  readonly ino: number
}

export async function listLogSegments(
  file: string,
  signal?: AbortSignal
): Promise<readonly LogSegment[]> {
  for (let attempt = 0; attempt <= MAX_SEGMENT_SNAPSHOT_RETRIES; attempt += 1) {
    try {
      return await listLogSegmentSnapshot(file, signal)
    } catch (err: unknown) {
      if (!isErrno(err, 'ENOENT')) {
        throw err
      }
      if (attempt === MAX_SEGMENT_SNAPSHOT_RETRIES) {
        throw new ConfigError('log segment snapshot did not stabilize', err)
      }
    }
  }

  throw new ConfigError('log segment snapshot retry state is invalid')
}

async function listLogSegmentSnapshot(
  file: string,
  signal: AbortSignal | undefined
): Promise<readonly LogSegment[]> {
  if (signal?.aborted) {
    return []
  }

  const parent = dirname(file)
  const base = basename(file)

  try {
    return await listLogSegmentsInDirectory(parent, base, signal)
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return []
    }

    throw err
  }
}

async function listLogSegmentsInDirectory(
  parent: string,
  base: string,
  signal: AbortSignal | undefined
): Promise<readonly LogSegment[]> {
  const identity = await openLogParent(parent)
  const entries = await readdir(parent)
  const names = collectSegmentNames(entries, base)

  if (names.length > MAX_LOG_SEGMENTS) {
    throw new ConfigError('too many log segments')
  }

  names.sort((left, right) => segmentNumber(base, left) - segmentNumber(base, right))
  const segments: LogSegment[] = []
  let totalBytes = 0

  for (const name of names) {
    if (signal?.aborted) {
      return []
    }

    let segment: LogSegment

    try {
      segment = await inspectSegment(parent, base, name)
    } catch (err: unknown) {
      if (isErrno(err, 'ENOENT')) {
        await assertStableParentAfterMissing(identity)
      }

      throw err
    }

    totalBytes += segment.size
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_LOG_SCAN_BYTES) {
      throw new ConfigError('log segments exceed the viewing limit')
    }

    segments.push(segment)
  }

  await assertLogParentIdentity(identity)
  return segments
}

async function assertStableParentAfterMissing(identity: LogParentIdentity): Promise<void> {
  try {
    await assertLogParentIdentity(identity)
  } catch (err: unknown) {
    throw new ConfigError('log parent changed during enumeration', err)
  }
}

function collectSegmentNames(entries: readonly string[], base: string): string[] {
  const names: string[] = []

  for (const name of entries) {
    if (!name.startsWith(`${base}.`)) {
      continue
    }
    if (!isLogSegmentName(base, name)) {
      throw new ConfigError('invalid log segment name')
    }

    names.push(name)
  }

  return names
}

async function openLogParent(parent: string): Promise<LogParentIdentity> {
  let handle: FileHandle | undefined

  try {
    handle = await open(parent, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const [opened, pathInfo, canonical] = await Promise.all([
      handle.stat(),
      lstat(parent),
      realpath(parent),
    ])

    if (
      !opened.isDirectory() ||
      pathInfo.isSymbolicLink() ||
      !pathInfo.isDirectory() ||
      opened.dev !== pathInfo.dev ||
      opened.ino !== pathInfo.ino ||
      canonical !== resolve(parent)
    ) {
      throw new ConfigError('log parent must be a stable real directory')
    }

    return { path: parent, canonical, dev: opened.dev, ino: opened.ino }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function assertLogParentIdentity(identity: LogParentIdentity): Promise<void> {
  const [info, canonical] = await Promise.all([lstat(identity.path), realpath(identity.path)])

  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    info.dev !== identity.dev ||
    info.ino !== identity.ino ||
    canonical !== identity.canonical
  ) {
    throw new ConfigError('log parent changed during enumeration')
  }
}

async function inspectSegment(parent: string, base: string, name: string): Promise<LogSegment> {
  const path = join(parent, name)
  const before = await lstat(path)
  let handle: FileHandle | undefined

  if (before.isSymbolicLink() || !before.isFile()) {
    throw new ConfigError('log segment must be a regular file')
  }

  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    const after = await handle.stat()

    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
      throw new ConfigError('log segment changed during validation')
    }

    return {
      path,
      number: segmentNumber(base, name),
      dev: after.dev,
      ino: after.ino,
      size: after.size,
    }
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function segmentNumber(base: string, name: string): number {
  const value = Number(name.slice(base.length + 1))

  if (!Number.isSafeInteger(value)) {
    throw new ConfigError('log segment number exceeds the viewing limit')
  }

  return value
}

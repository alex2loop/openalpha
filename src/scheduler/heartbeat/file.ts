import type { FileHandle } from 'node:fs/promises'
import { constants, open } from 'node:fs/promises'

import { isErrno } from '@/core/errors'

const MAX_FILE_BYTES = 65_536

/** Why a present HEARTBEAT.md was not read; a missing file is no problem, just no heartbeat yet. */
export type HeartbeatFileProblem = 'symlink' | 'not-regular' | 'oversized' | 'read-failed'

interface HeartbeatLoadedFile {
  readonly kind: 'loaded'
  readonly text: string
}

interface HeartbeatUnavailableFile {
  readonly kind: 'unavailable'
  readonly problem?: HeartbeatFileProblem
  readonly err?: unknown
}

export type HeartbeatFile = HeartbeatLoadedFile | HeartbeatUnavailableFile

export async function loadHeartbeatFile(file: string): Promise<HeartbeatFile> {
  const opened = await openHeartbeatFile(file)

  if (opened.kind === 'unavailable') {
    return opened
  }

  const { handle } = opened

  try {
    const info = await handle.stat()

    if (!info.isFile()) {
      return { kind: 'unavailable', problem: 'not-regular' }
    }

    if (info.size > MAX_FILE_BYTES) {
      return { kind: 'unavailable', problem: 'oversized' }
    }

    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1)
    let total = 0

    while (total <= MAX_FILE_BYTES) {
      const { bytesRead } = await handle.read(buffer, total, MAX_FILE_BYTES + 1 - total, null)

      if (bytesRead === 0) {
        break
      }
      total += bytesRead
    }

    if (total > MAX_FILE_BYTES) {
      return { kind: 'unavailable', problem: 'oversized' }
    }

    const text = total === 0 ? '' : buffer.toString('utf8', 0, total)
    return { kind: 'loaded', text }
  } catch (err: unknown) {
    return { kind: 'unavailable', problem: 'read-failed', err }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function openHeartbeatFile(
  file: string
): Promise<{ readonly kind: 'opened'; readonly handle: FileHandle } | HeartbeatUnavailableFile> {
  try {
    // The file sits in the agent's writable workspace: O_NOFOLLOW refuses a planted symlink and
    // O_NONBLOCK keeps a FIFO from parking the open forever (the isFile check rejects it).
    const handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )

    return { kind: 'opened', handle }
  } catch (err: unknown) {
    // Missing or unreadable files are normal: the agent has no heartbeat yet.
    return isErrno(err, 'ELOOP')
      ? { kind: 'unavailable', problem: 'symlink' }
      : { kind: 'unavailable' }
  }
}

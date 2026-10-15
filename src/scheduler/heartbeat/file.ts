import type { FileHandle } from 'node:fs/promises'
import { open } from 'node:fs/promises'

import type { Logger } from '@/core/logging/logger'
import { formatErrForLog } from '@/core/security/credentials'

const MAX_FILE_BYTES = 65_536

interface HeartbeatLoadedFile {
  readonly kind: 'loaded'
  readonly text: string
}

interface HeartbeatUnavailableFile {
  readonly kind: 'unavailable'
}

type HeartbeatFile = HeartbeatLoadedFile | HeartbeatUnavailableFile

export async function loadHeartbeatFile(file: string, logger: Logger): Promise<HeartbeatFile> {
  let handle: FileHandle | undefined

  try {
    handle = await open(file, 'r')
  } catch {
    // Missing or unreadable files are normal: the agent has no heartbeat yet.
    return { kind: 'unavailable' }
  }

  try {
    const info = await handle.stat()

    if (!info.isFile() || info.size > MAX_FILE_BYTES) {
      return { kind: 'unavailable' }
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
      logger.warn('heartbeat.file_oversized', { file, bytes: total })
      return { kind: 'unavailable' }
    }

    const text = total === 0 ? '' : buffer.toString('utf8', 0, total)
    return { kind: 'loaded', text }
  } catch (err: unknown) {
    logger.warn('heartbeat.file_read_failed', { file, err: formatErrForLog(err) })
    return { kind: 'unavailable' }
  } finally {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined)
    }
  }
}

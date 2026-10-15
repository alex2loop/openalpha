import type { SessionId } from '@/core/ids'
import { ToolError } from '@/core/errors'
import { lruMap } from '@/core/utils/collections'

const FILE_REVISION_MAX = 2_000
const FILE_EDIT_QUEUE_MAX = 10

interface EditLockState {
  readonly tails: Map<string, Promise<unknown>>
  readonly depths: Map<string, number>
}

export interface FileRevisionGuard {
  record(sessionId: SessionId, realPath: string, version: string): void
  lastKnown(sessionId: SessionId, realPath: string): string | undefined
  withEditLock<T>(realPath: string, edit: () => Promise<T>): Promise<T>
}

export function createFileRevisionGuard(): FileRevisionGuard {
  const versions = lruMap<string, string>(FILE_REVISION_MAX)
  const locks: EditLockState = { tails: new Map(), depths: new Map() }

  return Object.freeze({
    record(sessionId: SessionId, realPath: string, version: string): void {
      versions.set(toFileVersionKey(sessionId, realPath), version)
    },
    lastKnown(sessionId: SessionId, realPath: string): string | undefined {
      return versions.get(toFileVersionKey(sessionId, realPath))
    },
    withEditLock<T>(realPath: string, edit: () => Promise<T>): Promise<T> {
      const depth = locks.depths.get(realPath) ?? 0

      if (depth >= FILE_EDIT_QUEUE_MAX) {
        return Promise.reject(
          new ToolError('unexpected', 'too many edits are pending for this file')
        )
      }

      if (!locks.tails.has(realPath) && locks.tails.size >= FILE_REVISION_MAX) {
        return Promise.reject(
          new ToolError('unexpected', 'too many files are being edited concurrently')
        )
      }

      locks.depths.set(realPath, depth + 1)

      const previous = locks.tails.get(realPath) ?? Promise.resolve()
      const next = previous.then(edit)
      const tracked = next
        .catch(() => undefined)
        .finally(() => releaseEditLock(locks, realPath, tracked))

      locks.tails.set(realPath, tracked)
      return next
    },
  })
}

function releaseEditLock(locks: EditLockState, realPath: string, tracked: Promise<unknown>): void {
  const remaining = (locks.depths.get(realPath) ?? 1) - 1

  if (remaining <= 0) {
    locks.depths.delete(realPath)
  } else {
    locks.depths.set(realPath, remaining)
  }

  if (locks.tails.get(realPath) === tracked) {
    locks.tails.delete(realPath)
  }
}

function toFileVersionKey(sessionId: SessionId, realPath: string): string {
  return `${sessionId}:${realPath}`
}

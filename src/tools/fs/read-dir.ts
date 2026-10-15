import type { Dirent } from 'node:fs'
import { constants } from 'node:fs'
import { open, opendir } from 'node:fs/promises'

import type { WorkspaceIdentity } from '@/core/security/path-policy'
import { ToolError } from '@/core/errors'
import { PathPolicy } from '@/core/security/path-policy'

interface ReadDirInput {
  readonly workspace: WorkspaceIdentity
  readonly dirPath: string
  /** Stop after this many accepted entries; the caller decides what truncation means. */
  readonly limit: number
  readonly signal: AbortSignal
  readonly accept?: (entry: Dirent) => boolean
}

interface ReadDirResult {
  readonly entries: readonly Dirent[]
  readonly truncated: boolean
}

/**
 * Reads one directory under a descriptor pinned for the whole read. The identity is checked before
 * and after iterating, so a parent swapped for a symlink mid-read fails closed instead of yielding
 * entries from outside the workspace. Entries are bounded as they arrive — never read-then-cap.
 *
 * Ceiling: Node exposes no fd-based directory read, so `opendir` enumerates by path and a swap
 * reverted before the closing check is undetectable. Closing that needs an `openat` binding.
 */
export async function readDirPinned(input: ReadDirInput): Promise<ReadDirResult> {
  const handle = await open(
    input.dirPath,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
  ).catch((err: unknown) => {
    throw new ToolError('path_escape', `directory is unavailable: ${input.dirPath}`, err)
  })

  try {
    await PathPolicy.assertOpenedWithin(input.workspace, handle, input.dirPath)

    const result = await collect(input)

    await PathPolicy.assertOpenedWithin(input.workspace, handle, input.dirPath)
    return result
  } finally {
    await handle.close().catch(() => undefined)
  }
}

async function collect(input: ReadDirInput): Promise<ReadDirResult> {
  const entries: Dirent[] = []
  const dir = await opendir(input.dirPath)

  try {
    for await (const entry of dir) {
      if (input.signal.aborted) {
        return { entries, truncated: true }
      }

      if (input.accept !== undefined && !input.accept(entry)) {
        continue
      }

      if (entries.length >= input.limit) {
        return { entries, truncated: true }
      }

      entries.push(entry)
    }
  } finally {
    // Iterating to completion already closed it, and a second close resolves to nothing; only an
    // early return or a throw leaves the handle open.
    await Promise.resolve(dir.close()).catch(() => undefined)
  }

  return { entries, truncated: false }
}

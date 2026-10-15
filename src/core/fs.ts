import { opendir } from 'node:fs/promises'

import { isErrno } from '@/core/errors'

type DirectoryNames =
  | { readonly kind: 'absent' }
  | { readonly kind: 'names'; readonly names: readonly string[] }
  | { readonly kind: 'over-limit' }

// A directory that was never created is an empty walk, not a fault: log retention runs before the
// first agent writes, and a workspace scan runs before the agent has one. Every other errno —
// EACCES, ENOTDIR, EMFILE — still throws, so a real fault is never read as "nothing there".
//
// The ENOENT guard wraps the read, not just the open, because the two runtimes disagree about when
// a missing path is reported: Node rejects `opendir` eagerly, Bun resolves it and defers ENOENT to
// the first `read()`. Guarding the open alone left the absent arm unreachable on Bun and turned
// every fresh install's first retention sweep into a logged failure. A directory removed midway
// through enumeration lands here too, and is the same answer: it is gone, so there is nothing left
// to walk.
//
// Enumeration lives here rather than at each call site so that guard has one owner. Callers keep
// their own vocabulary for the bound: `over-limit` says the directory outgrew `limit`, and each
// caller raises the error that means something in its own context.
export async function readDirectoryNames(dirPath: string, limit: number): Promise<DirectoryNames> {
  const names: string[] = []

  try {
    const dir = await opendir(dirPath)

    try {
      while (true) {
        const entry = await dir.read()

        if (entry === null) {
          break
        }

        names.push(entry.name)

        if (names.length > limit) {
          return { kind: 'over-limit' }
        }
      }
    } finally {
      await Promise.resolve(dir.close()).catch(() => undefined)
    }
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return { kind: 'absent' }
    }

    throw err
  }

  return { kind: 'names', names: names.sort() }
}

import { join } from 'node:path'

import { parse as parseToml, stringify as stringifyToml } from 'smol-toml'

import { ConfigError } from '@/core/errors'
import { replacePrivateFileAtomic } from '@/core/security/private-files'
import { isPlainRecord } from '@/core/utils/collections'

type Lockfile = Record<string, Record<string, unknown>>

const LOCK_FILE = '.lock.toml'

export function resolveLockPath(skillsDir: string): string {
  return join(skillsDir, LOCK_FILE)
}

export async function readLock(lockPath: string): Promise<Lockfile> {
  const file = Bun.file(lockPath)

  if (!(await file.exists())) {
    return {}
  }

  const parsed: unknown = parseToml(await file.text())

  return isLockfile(parsed) ? parsed : {}
}

export async function writeLock(lockPath: string, lock: Lockfile): Promise<void> {
  await replacePrivateFileAtomic({
    path: lockPath,
    content: stringifyToml(lock),
    validate: assertLockfileText,
  })
}

// Every entry must be a table too: TOML accepts a top-level scalar, and a bare object check would
// hand the caller a `string` typed as one of these records.
function isLockfile(value: unknown): value is Lockfile {
  return isPlainRecord(value) && Object.values(value).every(isPlainRecord)
}

function assertLockfileText(content: string): void {
  const parsed: unknown = parseToml(content)

  if (!isLockfile(parsed)) {
    throw new ConfigError('generated skill lockfile is invalid')
  }
}

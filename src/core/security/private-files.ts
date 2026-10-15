import type { FileHandle } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

import { ConfigError, isErrno } from '@/core/errors'

export const PRIVATE_DIRECTORY_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600
/** Windows has no POSIX mode bits on a directory: chmod there fails and the reported bits are
 *  synthetic, so the user profile's ACL is the guard. */
export const HAS_DIRECTORY_MODES = process.platform !== 'win32'
const UNSUPPORTED_DIRECTORY_SYNC_CODES: ReadonlySet<string> = new Set([
  'EBADF',
  'EINVAL',
  'EISDIR',
  'ENOSYS',
  'ENOTSUP',
  'EPERM',
])

interface PrivateFileWrite {
  readonly path: string
  readonly content: string
  readonly validate?: (content: string) => void | Promise<void>
}

type PublishPrivateFile = (temporaryPath: string, targetPath: string) => Promise<void>

async function assertDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory()) {
    throw new ConfigError(`private directory path is not a directory: ${path}`)
  }
}

export async function ensurePrivateDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined

  try {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })

    // Windows also opens no directory handle.
    if (!HAS_DIRECTORY_MODES) {
      await assertDirectory(path)

      return
    }

    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const info = await handle.stat()

    if (!info.isDirectory()) {
      throw new ConfigError(`private directory path is not a directory: ${path}`)
    }

    await handle.chmod(PRIVATE_DIRECTORY_MODE)
    await syncDirectoryHandle(handle)
    await syncDirectory(dirname(path))
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError(`cannot prepare private directory: ${path}`, err)
  } finally {
    await closeQuietly(handle)
  }
}

export async function createPrivateFileAtomic(input: PrivateFileWrite): Promise<void> {
  await writePrivateFileAtomic(input, publishCreateOnly)
}

export async function replacePrivateFileAtomic(input: PrivateFileWrite): Promise<void> {
  await writePrivateFileAtomic(input, publishReplacement)
}

async function writePrivateFileAtomic(
  input: PrivateFileWrite,
  publish: PublishPrivateFile
): Promise<void> {
  const directory = dirname(input.path)
  const temporaryPath = join(directory, `.${basename(input.path)}.${randomUUID()}.tmp`)
  let handle: FileHandle | undefined

  await preparePrivateFileParent(directory)

  try {
    await assertRegularFileOrMissing(input.path)
    handle = await open(temporaryPath, 'wx', PRIVATE_FILE_MODE)
    await handle.chmod(PRIVATE_FILE_MODE)
    await handle.writeFile(input.content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined

    if (input.validate !== undefined) {
      await input.validate(await readFile(temporaryPath, 'utf8'))
    }

    await assertRegularFileOrMissing(input.path)
    await publish(temporaryPath, input.path)
    await unlinkIfPresent(temporaryPath)
    await syncDirectory(directory)
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError(`cannot write private file: ${input.path}`, err)
  } finally {
    await closeQuietly(handle)
    await cleanupTemporaryFile(temporaryPath, directory)
  }
}

async function publishCreateOnly(temporaryPath: string, targetPath: string): Promise<void> {
  try {
    await link(temporaryPath, targetPath)
  } catch (err: unknown) {
    if (isErrno(err, 'EEXIST')) {
      throw new ConfigError(`refusing to replace existing private file: ${targetPath}`, err)
    }

    throw err
  }
}

async function publishReplacement(temporaryPath: string, targetPath: string): Promise<void> {
  await rename(temporaryPath, targetPath)
}

async function preparePrivateFileParent(path: string): Promise<void> {
  let handle: FileHandle | undefined

  try {
    await mkdir(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const info = await lstat(path)

    if (info.isSymbolicLink()) {
      throw new ConfigError(`refusing private file parent symlink: ${path}`)
    }

    handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    const directoryInfo = await handle.stat()

    if (!directoryInfo.isDirectory()) {
      throw new ConfigError(`private file parent is not a directory: ${path}`)
    }

    await syncDirectoryHandle(handle)
    await syncDirectory(dirname(path))
  } catch (err: unknown) {
    if (err instanceof ConfigError) {
      throw err
    }

    throw new ConfigError(`cannot prepare private file parent: ${path}`, err)
  } finally {
    await closeQuietly(handle)
  }
}

async function assertRegularFileOrMissing(path: string): Promise<void> {
  try {
    const info = await lstat(path)

    if (info.isSymbolicLink()) {
      throw new ConfigError(`refusing private file symlink target: ${path}`)
    }
    if (!info.isFile()) {
      throw new ConfigError(`private file target is not a regular file: ${path}`)
    }
  } catch (err: unknown) {
    if (isErrno(err, 'ENOENT')) {
      return
    }

    throw err
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (err: unknown) {
    if (!isErrno(err, 'ENOENT')) {
      throw err
    }
  }
}

async function syncDirectory(path: string): Promise<void> {
  let handle: FileHandle | undefined

  try {
    handle = await open(path, 'r')
    await syncDirectoryHandle(handle)
  } catch (err: unknown) {
    if (!isUnsupportedDirectorySync(err)) {
      throw err
    }
  } finally {
    await closeQuietly(handle)
  }
}

async function syncDirectoryHandle(handle: FileHandle): Promise<void> {
  try {
    await handle.sync()
  } catch (err: unknown) {
    if (!isUnsupportedDirectorySync(err)) {
      throw err
    }
  }
}

async function cleanupTemporaryFile(path: string, directory: string): Promise<void> {
  try {
    await unlinkIfPresent(path)
    await syncDirectory(directory)
  } catch {
    // Cleanup is idempotent and must not mask the write, validation, or durability failure.
  }
}

async function closeQuietly(handle: FileHandle | undefined): Promise<void> {
  if (handle === undefined) {
    return
  }

  await handle.close().catch(() => {
    // Resource cleanup must not mask the primary failure.
  })
}

function isUnsupportedDirectorySync(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false
  }

  return typeof err.code === 'string' && UNSUPPORTED_DIRECTORY_SYNC_CODES.has(err.code)
}

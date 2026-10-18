import { chmod, link, rename, rm, stat } from 'node:fs/promises'

// `upgrade` only runs from a compiled binary, so this is the file it replaces.
const BINARY_PATH = process.execPath
const BINARY_MODE = 0o755
// Next to the binary, so every rename stays on one filesystem and is atomic.
export const DOWNLOAD_PATH = `${BINARY_PATH}.download`
const PREVIOUS_PATH = `${BINARY_PATH}.old`

/** Installs the downloaded release and keeps the one it replaces as the rollback copy. */
export async function installDownloadedBinary(): Promise<void> {
  await chmod(DOWNLOAD_PATH, BINARY_MODE)
  await moveAside(BINARY_PATH, PREVIOUS_PATH)

  try {
    await rename(DOWNLOAD_PATH, BINARY_PATH)
  } catch (err: unknown) {
    // Only Windows moved the binary away; elsewhere it is still in place.
    if (process.platform === 'win32') {
      await rename(PREVIOUS_PATH, BINARY_PATH)
    }

    throw err
  }
}

/** Exchanges the installed binary with the rollback copy, so a second call undoes the first. No
 *  step deletes a running file. */
export async function swapWithPreviousBinary(): Promise<void> {
  await moveAside(BINARY_PATH, DOWNLOAD_PATH)
  await rename(PREVIOUS_PATH, BINARY_PATH)
  await rename(DOWNLOAD_PATH, PREVIOUS_PATH)
}

export async function hasPreviousBinary(): Promise<boolean> {
  return await stat(PREVIOUS_PATH).then(
    () => true,
    () => false
  )
}

/** The one platform branch. POSIX links, so `from` stays in place and the command on PATH never goes
 *  missing before the rename that replaces it; Windows renames, because a running exe can be
 *  renamed but never replaced or deleted. */
async function moveAside(from: string, to: string): Promise<void> {
  await rm(to, { force: true })

  if (process.platform === 'win32') {
    await rename(from, to)
  } else {
    await link(from, to)
  }
}

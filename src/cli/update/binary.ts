import { chmod, copyFile, link, rename, rm, stat } from 'node:fs/promises'

// `upgrade` only runs from a compiled binary, so this is the file it replaces.
const BINARY_PATH = process.execPath
const BINARY_MODE = 0o755
// Next to the binary, so every rename stays on one filesystem and is atomic; per process, so two
// upgrades running at once never write into one file.
export const DOWNLOAD_PATH = `${BINARY_PATH}.download-${process.pid}`
const PREVIOUS_PATH = `${BINARY_PATH}.old`
const STAGED_PATH = `${BINARY_PATH}.staged-${process.pid}`

/** Installs the downloaded release and keeps the one it replaces as the rollback copy. */
export async function installDownloadedBinary(): Promise<void> {
  await chmod(DOWNLOAD_PATH, BINARY_MODE)
  await promote(DOWNLOAD_PATH)
}

/** Exchanges the installed binary with the rollback copy, so a second call undoes the first. */
export async function swapWithPreviousBinary(): Promise<void> {
  await promote(PREVIOUS_PATH)
}

export async function hasPreviousBinary(): Promise<boolean> {
  return await stat(PREVIOUS_PATH).then(
    () => true,
    () => false
  )
}

/** Puts `source` where the binary is and keeps the binary it replaces as the rollback copy. The old
 *  rollback copy is replaced only once the new binary is in place, so a failed step loses neither,
 *  and no step deletes a running file. */
async function promote(source: string): Promise<void> {
  await keepAside(BINARY_PATH, STAGED_PATH)

  try {
    await rename(source, BINARY_PATH)
  } catch (err: unknown) {
    await restoreStaged().catch(() => {
      // A failed restore must not hide why the swap failed; the staged copy is still on disk.
    })

    throw err
  }

  await rename(STAGED_PATH, PREVIOUS_PATH).catch(() => {
    // The new binary is already in place: a rollback copy still locked by a running old release
    // only leaves the previous one standing.
  })
}

/** The one platform branch. POSIX keeps `from` in place, so the command on PATH never goes missing
 *  before the rename that replaces it; Windows renames, because a running exe can be renamed but
 *  never replaced or deleted. */
async function keepAside(from: string, to: string): Promise<void> {
  await rm(to, { force: true })

  if (process.platform === 'win32') {
    await rename(from, to)

    return
  }

  // A filesystem without hard links gets a copy instead.
  await link(from, to).catch(async () => {
    await copyFile(from, to)
    await chmod(to, BINARY_MODE)
  })
}

async function restoreStaged(): Promise<void> {
  if (process.platform === 'win32') {
    await rename(STAGED_PATH, BINARY_PATH)

    return
  }

  await rm(STAGED_PATH, { force: true })
}

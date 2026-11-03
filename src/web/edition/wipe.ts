import { forgetSaveFile } from '@/web/edition/file-save'
import { dropHeldKeys } from '@/web/edition/keys-store'
import { stopEdition } from '@/web/edition/worker-link'

const REMOVE_ATTEMPTS = 8
const REMOVE_RETRY_MS = 250

/** "Xoá toàn bộ dữ liệu trên máy": clears the keys, agreements and settings in `localStorage` and
 *  `sessionStorage`, and the keys held in memory, first, so a later failure cannot leave them behind
 *  or write them back; then forgets the save file while the worker can still answer its last copy,
 *  ends the worker (which lets go of the database files) and deletes everything the page keeps in
 *  the browser's private file storage, then clears the two storages once more. Throws when a file
 *  cannot be removed, after every attempt, so the caller can say the wipe did not finish. */
export async function wipeEverything(): Promise<void> {
  clearBrowserStorage()
  dropHeldKeys()

  try {
    // The picked file stays where it is; the page no longer remembers it.
    await forgetSaveFile()
  } catch {
    // A handle store the browser will not open holds nothing the wipe can still reach.
  } finally {
    stopEdition()
  }

  const root = await navigator.storage.getDirectory()
  const names: string[] = []

  for await (const name of root.keys()) {
    names.push(name)
  }

  for (const name of names) {
    await removeWithRetry(root, name)
  }

  // The page ran through the removal and may have written a setting back.
  clearBrowserStorage()
}

function clearBrowserStorage(): void {
  try {
    localStorage.clear()
    sessionStorage.clear()
  } catch {
    // Blocked storage holds nothing of ours to clear.
  }
}

// A terminated worker releases its file handles a moment later, so a first attempt can still find
// the entry locked.
async function removeWithRetry(root: FileSystemDirectoryHandle, name: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await root.removeEntry(name, { recursive: true })

      return
    } catch (error: unknown) {
      if (attempt >= REMOVE_ATTEMPTS) {
        throw error
      }

      await new Promise((resolve) => setTimeout(resolve, REMOVE_RETRY_MS))
    }
  }
}

import { forgetSaveFile } from '@/web/edition/file-save'
import { stopEdition } from '@/web/edition/worker-link'

const REMOVE_ATTEMPTS = 8
const REMOVE_RETRY_MS = 250

/** "Xoá toàn bộ dữ liệu trên máy": ends the worker (which lets go of the database files), deletes
 *  the remembered save file, everything the page keeps in the browser's private file storage, then the keys, agreements and
 *  settings in `localStorage` and `sessionStorage`. Throws when a file cannot be removed, after
 *  every attempt, so the caller can say the wipe did not finish. */
export async function wipeEverything(): Promise<void> {
  stopEdition()
  // The picked file stays where it is; the page no longer remembers it.
  await forgetSaveFile()

  const root = await navigator.storage.getDirectory()

  for await (const name of root.keys()) {
    await removeWithRetry(root, name)
  }

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

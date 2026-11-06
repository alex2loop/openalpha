let asking: Promise<void> = Promise.resolve()

/** Asks the browser, from the page, to keep this origin's data when the device runs short of room.
 *  A browser may answer only a window, so the request is the page's. A refusal costs the visitor a
 *  reminder to export, not the page; `readKeepsData` waits for the answer. */
export function askToKeepData(): void {
  asking = requestPersistence()
}

/** What the browser says now about keeping the data, once the request has been answered; absent
 *  when it cannot say. */
export async function readKeepsData(): Promise<boolean | undefined> {
  await asking

  try {
    return await navigator.storage.persisted()
  } catch {
    return undefined
  }
}

// Never rejects.
async function requestPersistence(): Promise<void> {
  try {
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // A browser with no such request leaves the storage line out.
  }
}

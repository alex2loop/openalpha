/** Asks the browser, from the page, to keep this origin's data when the device runs short of room.
 *  A browser may answer only a window, so the request is the page's. Never rejects: a refusal costs
 *  the visitor a reminder to export, not the page. */
export async function askToKeepData(): Promise<void> {
  try {
    if (!(await navigator.storage.persisted())) {
      await navigator.storage.persist()
    }
  } catch {
    // A browser with no such request leaves the storage line out.
  }
}

/** What the browser says now about keeping the data; absent when it cannot say. */
export async function readKeepsData(): Promise<boolean | undefined> {
  try {
    return await navigator.storage.persisted()
  } catch {
    return undefined
  }
}

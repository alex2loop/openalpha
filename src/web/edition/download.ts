const REVOKE_MS = 2_000

/** Hands the visitor `blob` as a file named `name`; the address is released once the browser has
 *  had time to start the save. */
export async function downloadBlob(blob: Blob, name: string): Promise<void> {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  try {
    link.href = url
    link.download = name
    link.hidden = true
    document.body.append(link)
    link.click()
    await new Promise((resolve) => setTimeout(resolve, REVOKE_MS))
  } finally {
    link.remove()
    URL.revokeObjectURL(url)
  }
}

import { dirname } from 'node:path'

import {
  createPrivateFileAtomic,
  ensurePrivateDirectory,
  replacePrivateFileAtomic,
} from '@/core/security/private-files'

/** Creates the file or replaces it whole: a reader never sees half of it. */
export async function writePrivateText(path: string, content: string): Promise<void> {
  await ensurePrivateDirectory(dirname(path))

  if (await Bun.file(path).exists()) {
    await replacePrivateFileAtomic({ path, content })
    return
  }

  await createPrivateFileAtomic({ path, content })
}

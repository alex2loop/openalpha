import { join } from 'node:path'

import { ensurePrivateDirectory } from '@/core/security/private-files'

const SKILLS_SUBDIR = 'skills'

// The one canonical "data-dir skills path" helper: the available-skills hook and the app's wiring
// must agree on it or a skill is listed but not loadable.
export function resolveSkillsDir(dataDir: string): string {
  return join(dataDir, SKILLS_SUBDIR)
}

export async function ensureSkillsDirectory(dataDir: string): Promise<string> {
  const path = resolveSkillsDir(dataDir)

  await ensurePrivateDirectory(path)
  return path
}

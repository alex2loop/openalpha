import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { constants, open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { SkillMeta } from '@/engine/skills/types'
import { abortError } from '@/core/errors'
import { PathPolicy } from '@/core/security/path-policy'
import { parseFrontmatter } from '@/engine/skills/frontmatter'
import {
  buildSkillMeta,
  isSafeSkillName,
  SKILL_MAX_BYTES,
  type SkillDoc,
  stripRoleBoundaries,
} from '@/engine/skills/skill-text'

const SKILL_FILE = 'SKILL.md'
// True when `file` resolves inside `root` after symlink resolution. Closes the symlink-escape
// attack (`ln -s /etc/passwd skills/evil/SKILL.md`). PathPolicy throws; the scanner wants a boolean.
async function isResolvedInside(root: string, file: string, signal: AbortSignal): Promise<boolean> {
  throwIfAborted(signal)

  try {
    const identity = await PathPolicy.identify(root)

    throwIfAborted(signal)
    await PathPolicy.forRead(identity).resolve(file)

    throwIfAborted(signal)

    return true
  } catch {
    throwIfAborted(signal)
    // Outside the root, a blocked device path, or missing — all mean "do not load it".
    return false
  }
}

async function loadSkillIndex(
  skillsDir: string,
  signal: AbortSignal
): Promise<readonly SkillMeta[]> {
  const names = await listSubdirs(skillsDir, signal)

  if (names.length === 0) {
    return []
  }

  const found = await Promise.all(names.map((name) => readSkill(skillsDir, name, signal)))

  return found
    .filter((meta): meta is SkillMeta => meta !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Merge several skill dirs into one index; earlier dirs win on a name collision (user skills shadow
// plugin skills). A missing dir contributes nothing.
export async function loadSkillIndexFromDirs(
  dirs: readonly string[],
  signal: AbortSignal
): Promise<readonly SkillMeta[]> {
  throwIfAborted(signal)
  const indices = await Promise.all(dirs.map((dir) => loadSkillIndex(dir, signal)))
  throwIfAborted(signal)
  const byName = new Map<string, SkillMeta>()

  for (const skill of indices.flat()) {
    if (!byName.has(skill.name)) {
      byName.set(skill.name, skill)
    }
  }

  return [...byName.values()]
}

// Covers every SKILL.md that stats, accepted or not: the cached index is keyed by this value, so a
// rejected file must not make the next lookup miss.
export async function loadSkillIndexFingerprint(
  dirs: readonly string[],
  signal: AbortSignal
): Promise<string> {
  const entries: { readonly path: string; readonly mtimeMs: number; readonly size: number }[] = []

  for (const base of dirs) {
    const names = await listSubdirs(base, signal)

    for (const name of names) {
      const skillMd = join(base, name, SKILL_FILE)

      if (await isResolvedInside(base, skillMd, signal)) {
        const stats = await stat(skillMd).catch(() => undefined)

        throwIfAborted(signal)

        if (stats !== undefined) {
          entries.push({ path: skillMd, mtimeMs: stats.mtimeMs, size: stats.size })
        }
      }
    }
  }

  return fingerprintFromEntries(entries)
}

function fingerprintFromEntries(
  entries: readonly { readonly path: string; readonly mtimeMs: number; readonly size: number }[]
): string {
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))
  const hash = createHash('sha256')

  for (const entry of sorted) {
    hash.update(`${entry.path}\0${entry.mtimeMs}\0${entry.size}\n`)
  }

  return hash.digest('hex')
}

// The first dir holding a readable SKILL.md for `name` wins, matching the index's shadowing order.
// Every path that puts skill text in front of a model reads through here, so the role-boundary
// strip happens once, at the read. `size` stays the on-disk byte count the reader is charged for.
export async function readSkillDoc(
  dirs: readonly string[],
  name: string,
  signal: AbortSignal
): Promise<SkillDoc | undefined> {
  throwIfAborted(signal)

  if (!isSafeSkillName(name)) {
    return undefined
  }

  for (const base of dirs) {
    const file = await readSkillFile(base, name, signal)

    if (file !== undefined) {
      return { text: stripRoleBoundaries(file.text), size: file.size }
    }
  }

  return undefined
}

/**
 * Skill text that never touched the filesystem, as the same document a file read produces: role
 * boundaries stripped once, `size` the text's own byte count so prompt accounting charges the same
 * units either way.
 */
async function readSkill(
  skillsDir: string,
  name: string,
  signal: AbortSignal
): Promise<SkillMeta | undefined> {
  const file = await readSkillFile(skillsDir, name, signal)

  if (file === undefined) {
    return undefined
  }

  const meta = buildSkillMeta(parseFrontmatter(file.text))

  // `readSkillDoc` reads `<dir>/<name>/SKILL.md`, so a skill filed under another name would be
  // listed yet unreadable.
  return meta?.name === name ? meta : undefined
}

// Reads `base/<name>/SKILL.md` through a descriptor checked against the configured base dir, not
// against the skill dir it just resolved: a base swapped for a symlink after the lookup would
// otherwise become the new root and admit an external SKILL.md.
async function readSkillFile(
  base: string,
  name: string,
  signal: AbortSignal
): Promise<SkillDoc | undefined> {
  const path = join(base, name, SKILL_FILE)
  let handle: FileHandle | undefined

  try {
    throwIfAborted(signal)
    const identity = await PathPolicy.identify(base)
    throwIfAborted(signal)
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)

    throwIfAborted(signal)
    await PathPolicy.assertOpenedWithin(identity, handle, path)
    const info = await handle.stat()

    throwIfAborted(signal)

    if (!info.isFile() || info.size > SKILL_MAX_BYTES) {
      return undefined
    }

    const text = await handle.readFile('utf8')

    throwIfAborted(signal)
    return { text, size: info.size }
  } catch {
    throwIfAborted(signal)
    // Missing, swapped, oversized, or outside the base dir — all mean "do not load it".
    return undefined
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

async function listSubdirs(dir: string, signal: AbortSignal): Promise<readonly string[]> {
  throwIfAborted(signal)

  try {
    const entries = await readdir(dir, { withFileTypes: true })

    throwIfAborted(signal)

    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    throwIfAborted(signal)
    // A missing or unreadable skills dir simply contributes no skills.
    return []
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}

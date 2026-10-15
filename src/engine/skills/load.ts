import type { FileHandle } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { constants, open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { SkillMeta } from '@/engine/skills/types'
import { abortError } from '@/core/errors'
import { PathPolicy } from '@/core/security/path-policy'
import { scanSkill } from '@/core/security/sanitize'
import { parseFrontmatter, stripFrontmatter } from '@/engine/skills/frontmatter'

// agentskills.io spec limits. Clamping description prevents oversized values bloating the
// <available_skills> prompt block.
const SKILL_NAME_MAX = 64
const SKILL_DESC_MAX = 1024

// Strict kebab-case per agentskills.io.
const SAFE_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/

const ROLE_BOUNDARY_RE =
  /^\s*<\s*\/?\s*(system|human|assistant|user|tool_use|tool_result)\b[^>]*>\s*$/i
const WS_RE = /\s+/
const BRACKETS_RE = /^\[|\]$/g
const SKILL_FILE = 'SKILL.md'
const SKILL_MAX_BYTES = 1_048_576
// Replaces a description flagged by the injection scanner — the skill stays indexable.
const NEUTRAL_DESCRIPTION = '(description removed: flagged content)'

// Strip chat-role tag lines so a SKILL.md cannot inject a fake role boundary that some models read
// as a system-prompt update.
function stripRoleBoundaries(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !ROLE_BOUNDARY_RE.test(line))
    .join('\n')
}

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

export interface SkillDoc {
  readonly text: string
  readonly size: number
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

  if (!SAFE_NAME_RE.test(name)) {
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
export function toSkillDoc(text: string): SkillDoc {
  return { text: stripRoleBoundaries(text), size: Buffer.byteLength(text, 'utf8') }
}

/**
 * Skill text as prompt body: the instructions alone, with the front matter dropped as noise and
 * role boundaries stripped exactly as a `skill_view` read strips them. Every path that puts skill
 * text in front of a model goes through one of these two, so neither can grow a weaker rule.
 */
export function toSkillBody(text: string): string {
  return stripFrontmatter(stripRoleBoundaries(text)).trim()
}

/** Index metadata for skill text held in memory, parsed by the one frontmatter reader. */
export function readSkillMeta(text: string): SkillMeta | undefined {
  const bytes = Buffer.byteLength(text, 'utf8')

  return bytes > SKILL_MAX_BYTES ? undefined : buildSkillMeta(parseFrontmatter(text))
}

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

/**
 * The name a SKILL.md claims, or undefined when the loader would refuse it. `skill install` writes
 * the skill under this name: a file the loader ignores is worse than a refused install.
 */
export function readSkillName(text: string): string | undefined {
  const name = parseFrontmatter(text).name

  if (name === undefined || name.length > SKILL_NAME_MAX || !SAFE_NAME_RE.test(name)) {
    return undefined
  }

  return name
}

function buildSkillMeta(fm: Record<string, string>): SkillMeta | undefined {
  const name = fm.name

  if (name === undefined || name.length > SKILL_NAME_MAX || !SAFE_NAME_RE.test(name)) {
    return undefined
  }

  return {
    name,
    description: sanitizeDescription(fm.description ?? ''),
    ...optional('version', readField(fm, 'version')),
    ...optional('author', readField(fm, 'author')),
    ...optional('license', fm.license),
    ...optional('category', readField(fm, 'category')),
    ...optionalList('tags', readField(fm, 'tags')),
    ...optionalList('requiresTools', readField(fm, 'requires_tools')),
    ...optionalList('fallbackForTools', readField(fm, 'fallback_for_tools')),
    ...optionalList('platforms', readField(fm, 'platforms')),
  }
}

// Length-cap the description; replace it entirely when the injection scanner flags a block.
function sanitizeDescription(raw: string): string {
  const capped = raw.slice(0, SKILL_DESC_MAX)
  const blocked = scanSkill(capped).some((t) => t.severity === 'block')

  return blocked ? NEUTRAL_DESCRIPTION : capped
}

// The agentskills.io spec defines only `name`, `description`, `license`, `compatibility`,
// `metadata` and `allowed-tools`; everything else a skill wants to say belongs under `metadata`.
// Hermes nests one level deeper again. A top-level key still wins, because skills written against
// that convention are common enough to read.
function readField(fm: Record<string, string>, key: string): string | undefined {
  return fm[key] ?? fm[`metadata.${key}`] ?? fm[`metadata.hermes.${key}`]
}

function optional(key: string, value: string | undefined): Record<string, string> {
  return value === undefined || value === '' ? {} : { [key]: value }
}

function optionalList(
  key: string,
  raw: string | undefined
): Record<string, readonly string[]> | Record<string, never> {
  const list = parseList(raw)

  return list === undefined ? {} : { [key]: list }
}

// Accepts `a, b, c` / `a b c` / `[a, b, c]` / `[a b c]`. Comma takes precedence so multi-word values
// survive when both separators are present.
function parseList(raw: string | undefined): readonly string[] | undefined {
  if (raw === undefined || raw === '') {
    return undefined
  }

  const inner = raw.replace(BRACKETS_RE, '').trim()

  if (inner === '') {
    return undefined
  }

  const parts = inner.includes(',') ? inner.split(',') : inner.split(WS_RE)
  const items = parts.map((part) => part.trim()).filter((part) => part.length > 0)

  return items.length > 0 ? items : undefined
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

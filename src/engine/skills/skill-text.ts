import type { SkillMeta } from '@/engine/skills/types'
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

export const SKILL_MAX_BYTES = 1_048_576
// Replaces a description flagged by the injection scanner — the skill stays indexable.
const NEUTRAL_DESCRIPTION = '(description removed: flagged content)'

export function isSafeSkillName(name: string): boolean {
  return SAFE_NAME_RE.test(name)
}

// Strip chat-role tag lines so a SKILL.md cannot inject a fake role boundary that some models read
// as a system-prompt update.
export function stripRoleBoundaries(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !ROLE_BOUNDARY_RE.test(line))
    .join('\n')
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
  const bytes = new TextEncoder().encode(text).byteLength

  return bytes > SKILL_MAX_BYTES ? undefined : buildSkillMeta(parseFrontmatter(text))
}

/**
 * The name a SKILL.md claims, or undefined when the loader would refuse it. `skill install` writes
 * the skill under this name: a file the loader ignores is worse than a refused install.
 */
export function readSkillName(text: string): string | undefined {
  const name = parseFrontmatter(text).name

  if (name === undefined || name.length > SKILL_NAME_MAX || !isSafeSkillName(name)) {
    return undefined
  }

  return name
}

export function buildSkillMeta(fm: Record<string, string>): SkillMeta | undefined {
  const name = fm.name

  if (name === undefined || name.length > SKILL_NAME_MAX || !isSafeSkillName(name)) {
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

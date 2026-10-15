import type { SkillVisibility } from '@/engine/skills/availability'
import type { SkillDoc } from '@/engine/skills/load'
import type { SkillMeta } from '@/engine/skills/types'
import { abortError, ConfigError } from '@/core/errors'
import { isSkillVisible } from '@/engine/skills/availability'
import {
  loadSkillIndexFingerprint,
  loadSkillIndexFromDirs,
  readSkillDoc,
  readSkillMeta,
  toSkillDoc,
} from '@/engine/skills/load'

export interface SkillCatalog {
  list(visibility: SkillVisibility, signal: AbortSignal): Promise<readonly SkillMeta[]>
  find(
    name: string,
    visibility: SkillVisibility,
    signal: AbortSignal
  ): Promise<SkillDoc | undefined>
  /** Throws when an embedded skill owns `name`; the same refusal a reserved name on disk gets. */
  assertNotReserved(name: string): void
}

interface CachedIndex {
  readonly fingerprint: string
  readonly skills: readonly SkillMeta[]
}

export function createSkillCatalog(options: {
  readonly embedded: readonly string[]
  readonly directories: readonly string[]
}): SkillCatalog {
  const reserved = parseEmbedded(options.embedded)
  let cached: CachedIndex | undefined

  return {
    async list(visibility, signal): Promise<readonly SkillMeta[]> {
      const skills = await index(signal)

      return skills.filter((skill) => isSkillVisible(skill, visibility))
    },

    async find(name, visibility, signal): Promise<SkillDoc | undefined> {
      const skills = await index(signal)
      const meta = skills.find((skill) => skill.name === name)

      if (meta === undefined || !isSkillVisible(meta, visibility)) {
        return undefined
      }

      return reserved.docs.get(name) ?? (await readSkillDoc(options.directories, name, signal))
    },

    assertNotReserved(name): void {
      assertNotReservedName(name, reserved.metas)
    },
  }

  async function index(signal: AbortSignal): Promise<readonly SkillMeta[]> {
    assertActive(signal)
    return refresh(signal)
  }

  async function refresh(signal: AbortSignal): Promise<readonly SkillMeta[]> {
    const fingerprint = await loadSkillIndexFingerprint(options.directories, signal)

    if (cached?.fingerprint === fingerprint) {
      return cached.skills
    }

    const loaded = await loadSkillIndexFromDirs(options.directories, signal)

    assertNoReservedSkills(loaded, reserved.metas)

    const skills = [...reserved.metas.values(), ...loaded].sort((a, b) =>
      a.name.localeCompare(b.name)
    )

    cached = { fingerprint, skills }

    return skills
  }
}

function parseEmbedded(texts: readonly string[]): {
  readonly metas: ReadonlyMap<string, SkillMeta>
  readonly docs: ReadonlyMap<string, SkillDoc>
} {
  const metas = new Map<string, SkillMeta>()
  const docs = new Map<string, SkillDoc>()

  for (const [index, text] of texts.entries()) {
    const meta = readSkillMeta(text)

    if (meta === undefined) {
      throw new ConfigError(
        `embedded skill at index ${index} is malformed or exceeds the size limit`
      )
    }

    if (metas.has(meta.name)) {
      throw new ConfigError(`duplicate embedded skill '${meta.name}'`)
    }

    // A bundled skill is prose that shapes what the product recommends, so it carries a version an
    // edit must bump; without one, advice changes while every version field stays identical.
    if (meta.version === undefined || meta.version.trim() === '') {
      throw new ConfigError(`embedded skill '${meta.name}' must declare a non-empty version`)
    }

    metas.set(meta.name, meta)
    docs.set(meta.name, toSkillDoc(text))
  }

  return { metas, docs }
}

function assertNoReservedSkills(
  skills: readonly SkillMeta[],
  reserved: ReadonlyMap<string, SkillMeta>
): void {
  for (const skill of skills) {
    assertNotReservedName(skill.name, reserved)
  }
}

function assertNotReservedName(name: string, reserved: ReadonlyMap<string, SkillMeta>): void {
  if (reserved.has(name)) {
    throw new ConfigError(`skill '${name}' is reserved by an embedded skill`)
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}

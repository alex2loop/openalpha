import type { SkillVisibility } from '@/engine/skills/availability'
import type { SkillDoc } from '@/engine/skills/skill-text'
import type { SkillMeta } from '@/engine/skills/types'
import { abortError } from '@/core/errors'
import { isSkillVisible } from '@/engine/skills/availability'
import { assertNotReservedName, parseEmbedded } from '@/engine/skills/embedded-catalog'
import {
  loadSkillIndexFingerprint,
  loadSkillIndexFromDirs,
  readSkillDoc,
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

function assertNoReservedSkills(
  skills: readonly SkillMeta[],
  reserved: ReadonlyMap<string, SkillMeta>
): void {
  for (const skill of skills) {
    assertNotReservedName(skill.name, reserved)
  }
}

function assertActive(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError(signal)
  }
}

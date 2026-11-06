import type { SkillCatalog } from '@/engine/skills/catalog'
import type { SkillMeta } from '@/engine/skills/types'
import { ConfigError } from '@/core/errors'
import { isSkillVisible } from '@/engine/skills/availability'
import { readSkillMeta, type SkillDoc, toSkillDoc } from '@/engine/skills/skill-text'

/** The skills bundled in the product and nothing else: a host with no directory to read (the
 *  browser worker) offers these, and `createSkillCatalog` layers the directories over the same set. */
export function createEmbeddedSkillCatalog(embedded: readonly string[]): SkillCatalog {
  const { metas, docs } = parseEmbedded(embedded)
  const all = [...metas.values()].sort((a, b) => a.name.localeCompare(b.name))

  return {
    list: async (visibility) => all.filter((skill) => isSkillVisible(skill, visibility)),
    find: async (name, visibility) => {
      const meta = metas.get(name)

      return meta !== undefined && isSkillVisible(meta, visibility) ? docs.get(name) : undefined
    },
    assertNotReserved: (name) => assertNotReservedName(name, metas),
  }
}

export function parseEmbedded(texts: readonly string[]): {
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

export function assertNotReservedName(
  name: string,
  reserved: ReadonlyMap<string, SkillMeta>
): void {
  if (reserved.has(name)) {
    throw new ConfigError(`skill '${name}' is reserved by an embedded skill`)
  }
}

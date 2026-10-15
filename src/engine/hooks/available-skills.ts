// Wired in app/providers.ts, NOT engine/services.ts — the catalog's search dirs come from plugins,
// which engine has no DAG edge to.

import type { SkillCatalog } from '@/engine/skills/catalog'
import type { SkillMeta } from '@/engine/skills/types'
import type { LLMRequestModifier } from '@/engine/types/run'
import { escapeXml } from '@/core/security/sanitize'
import { truncate } from '@/core/utils/text'
import { appendSystemBlock } from '@/engine/hooks/system-block'
import { resolveSkillPlatform } from '@/engine/skills/availability'

/** Shared by every surface that prints the skills index, so the two catalogs cannot drift. */
export const SKILL_CATALOG_GUIDANCE =
  'When the ask matches a skill below, call skill_view with its exact name and follow the method it returns before answering. Load at most the one or two that match.'
// Display caps for the prompt block; skill_view returns the full body.
const SKILL_INDEX_DESC_MAX = 200
const SKILL_INDEX_BLOCK_MAX = 8_192
const SKILL_VIEW_TOOL = 'skill_view'

export function createAvailableSkillsModifier(catalog: SkillCatalog): LLMRequestModifier {
  return async (run, req) => {
    // Gate on the tools this run actually exposes, never on the agent profile: a run narrowed by
    // `allowedTools` keeps the profile's entry, so gating there advertises a catalog and a
    // `skill_view` call the request cannot carry.
    const tools = new Set(run.env.tools.map((tool) => tool.name))

    if (!tools.has(SKILL_VIEW_TOOL)) {
      return req
    }

    const skills = await catalog.list(
      { allowed: run.env.agent.skills, tools, platform: resolveSkillPlatform(process.platform) },
      run.state.abort.signal
    )

    if (skills.length === 0) {
      return req
    }

    const { body, dropped } = formatSkillLines(skills)
    const tail = dropped > 0 ? `\n[+${dropped} skills omitted - block cap reached]` : ''

    return appendSystemBlock(
      req,
      `<available_skills>\n${SKILL_CATALOG_GUIDANCE}\n${body.trimEnd()}${tail}\n</available_skills>`
    )
  }
}

function formatSkillLines(skills: readonly SkillMeta[]): {
  readonly body: string
  readonly dropped: number
} {
  let body = ''
  let bytes = 0
  let dropped = 0

  for (const skill of skills) {
    const name = escapeXml(skill.name)
    const desc = escapeXml(truncate(skill.description, SKILL_INDEX_DESC_MAX))
    const full = `- ${name}: ${desc}\n`
    const fullBytes = Buffer.byteLength(full, 'utf8')

    if (bytes + fullBytes <= SKILL_INDEX_BLOCK_MAX) {
      body += full
      bytes += fullBytes
      continue
    }

    // The description did not fit; fall back to a name-only line so the model can still request it.
    const nameOnly = `- ${name}\n`
    const nameOnlyBytes = Buffer.byteLength(nameOnly, 'utf8')

    if (bytes + nameOnlyBytes <= SKILL_INDEX_BLOCK_MAX) {
      body += nameOnly
      bytes += nameOnlyBytes
    } else {
      dropped += 1
    }
  }

  return { body, dropped }
}

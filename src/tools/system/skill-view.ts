import { z } from 'zod'

import type { ToolInvocationContext } from '@/core/tool'
import { ToolError } from '@/core/errors'
import { createTool } from '@/core/tool'
import { resolveSkillPlatform } from '@/engine/api'

export const skillViewTool = createTool({
  name: 'skill_view',
  description:
    'Loads the full text of one skill from the <available_skills> index by its exact name. Use it before acting whenever the ask matches a listed skill; the body is the method to follow, not data to report. Returns Markdown instructions. A name not in the index is refused.',
  inputSchema: z.object({
    name: z.string().min(1).describe('Exact skill name from the <available_skills> index.'),
  }),
  capability: 'read',
  // Eager because the <available_skills> block names it on every turn: a model told to call a
  // tool whose schema it cannot see either declines or invents the call, and a strict provider
  // cannot emit an unlisted name at all.
  eager: true,
  presentation: { label: 'View skill', emoji: '📜', detailKeys: ['name'] },
  async execute(args, ctx): Promise<string> {
    const doc = await ctx.services.skillCatalog.find(
      args.name,
      {
        allowed: allowedSkills(ctx),
        tools: new Set(ctx.services.agents.get(ctx.agentId)?.tools ?? []),
        platform: resolveSkillPlatform(process.platform),
      },
      ctx.signal
    )

    if (doc === undefined) {
      throw new ToolError('file_not_found', `skill not found: ${args.name}`)
    }

    ctx.skillViewBudget.charge(doc.size)

    return doc.text
  },
})

function allowedSkills(ctx: ToolInvocationContext): readonly string[] | undefined {
  return ctx.services.agents.get(ctx.agentId)?.skills
}

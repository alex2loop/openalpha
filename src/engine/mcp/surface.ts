import type { ToolDefinition, ToolResult } from '@/core/tool'
import type { SkillVisibility } from '@/engine/skills/availability'
import type { SkillCatalog } from '@/engine/skills/catalog'
import type { SkillMeta } from '@/engine/skills/types'
import type { AgentProfile } from '@/engine/types/agent'
import type { McpToolInvocation, McpToolInvoker } from '@/engine/types/run'
import { DEFAULT_AGENT_ID } from '@/core/ids'
import {
  buildServerInstructions,
  buildSkillsCatalog,
  exposedToolNames,
} from '@/engine/mcp/serve-core'
import { resolveSkillPlatform } from '@/engine/skills/availability'

export interface McpSurface {
  tools(): readonly ToolDefinition[]
  instructions(): Promise<string>
  invoke(input: McpToolInvocation): Promise<ToolResult>
}

export interface McpSurfaceDeps {
  readonly tools: ReadonlyMap<string, ToolDefinition>
  readonly agents: ReadonlyMap<string, AgentProfile>
  readonly invoker: McpToolInvoker
  readonly catalog: SkillCatalog
  readonly signal: AbortSignal
}

export function createMcpSurface(deps: McpSurfaceDeps): McpSurface {
  return {
    tools: () => exposedTools(deps),
    instructions: () => serverInstructions(deps),
    invoke: (input) => deps.invoker.invoke(input),
  }
}

function exposedTools(deps: McpSurfaceDeps): readonly ToolDefinition[] {
  const agent = deps.agents.get(DEFAULT_AGENT_ID)

  if (agent === undefined) {
    return []
  }

  return exposedToolNames(deps.tools).flatMap((name) => {
    const tool = deps.tools.get(name)

    return tool === undefined || !agent.tools.includes(name) ? [] : [tool]
  })
}

async function serverInstructions(deps: McpSurfaceDeps): Promise<string> {
  const agent = deps.agents.get(DEFAULT_AGENT_ID)

  if (agent === undefined) {
    return ''
  }

  const exposed = exposedTools(deps).map((tool) => tool.name)
  const skills = await visibleSkills(deps)
  const catalog = exposed.includes('skill_view') ? buildSkillsCatalog(skills) : ''

  return buildServerInstructions(catalog)
}

async function visibleSkills(deps: McpSurfaceDeps): Promise<readonly SkillMeta[]> {
  const agent = deps.agents.get(DEFAULT_AGENT_ID)

  if (agent === undefined) {
    return []
  }

  return deps.catalog.list(skillVisibility(deps, agent), deps.signal)
}

function skillVisibility(deps: McpSurfaceDeps, agent: AgentProfile): SkillVisibility {
  return {
    allowed: agent.skills,
    tools: new Set(exposedTools(deps).map((tool) => tool.name)),
    platform: resolveSkillPlatform(process.platform),
  }
}

import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'

import type { Capability, ToolDefinition } from '@/core/tool'
import type { SkillMeta } from '@/engine/skills/types'
import { escapeXml } from '@/core/security/sanitize'
import { toToolSchema } from '@/core/tool'
import { SKILL_CATALOG_GUIDANCE } from '@/engine/hooks/available-skills'
import { canRequireApproval } from '@/engine/hooks/dangerous'
import { MCP_SERVER_INSTRUCTIONS } from '@/engine/mcp/instructions'

// Withheld by what the capability already says. delegate spends this operator's model budget
// driving an agent loop for a host that has its own; a fired schedule_* job delivers to the
// operator's default channel rather than the caller.
const MCP_EXCLUDED_CAPABILITIES: ReadonlySet<Capability> = new Set(['delegate', 'schedule'])

// Withheld by name where the capability cannot separate them. No conversation to use:
// ask_clarification and todo_write need the interactive loop. The file readers see only the agent
// scratch dir the withheld writers would have filled, which is nothing a host with real file tools
// wants. memory_store and memory_remove rewrite the operator's durable memory. order_place is
// irreversible at a real exchange, and a client program answering the approval is not the human the
// gate exists for. web_search and web_fetch: the host brings its own, and this server reads no
// search configuration. social_request and social_skill act as one of the operator's own agents on
// a public network: a client program on this server must never speak as one, and `net` and `read`
// are not capabilities this server withholds. Other domain writes stay exposed - this server
// validates those itself.
const MCP_TOOL_DENYLIST: ReadonlySet<string> = new Set([
  'ask_clarification',
  'social_request',
  'social_skill',
  'todo_write',
  'file_read',
  'file_list',
  'file_search',
  'memory_store',
  'memory_remove',
  'order_place',
  'web_search',
  'web_fetch',
])

const FILE_WRITERS: ReadonlySet<string> = new Set(['file_write', 'file_edit'])

/** Tools whose approval a client program would answer as a program, not as the person the gate
 *  exists for: shell runs code and the file writers change the host's disk. A plugin- or
 *  MCP-contributed tool is external: re-offering it would put another server's tools behind this
 *  one's name, and the host can connect that server itself. */
export function isClientApprovalWithheld(name: string, tool: ToolDefinition): boolean {
  return tool.capability === 'shell' || tool.isExternal === true || FILE_WRITERS.has(name)
}

/** One entry as `tools/list` sends it, for every transport that serves this surface. */
export interface AdvertisedTool {
  readonly name: string
  readonly description: string
  readonly inputSchema: Record<string, unknown> & { readonly type: 'object' }
  readonly annotations: ToolAnnotations
}

export function toAdvertisedTools(tools: readonly ToolDefinition[]): readonly AdvertisedTool[] {
  return tools.map((tool) => {
    const { name, description, parameters } = toToolSchema(tool)

    // MCP requires an object at the root, which a union's bare `oneOf` omits; its branches are all
    // objects, so the root type is restored rather than invented.
    return {
      name,
      description,
      inputSchema: { ...parameters, type: 'object' as const },
      annotations: toToolAnnotations(tool),
    }
  })
}

/** Only what the definition proves: `read` without a gate touches nothing, `net` leaves the
 *  process, and `write` is the one arm that can destroy. A gated read mutates, so it claims
 *  nothing. */
function toToolAnnotations(tool: ToolDefinition): ToolAnnotations {
  return {
    readOnlyHint: tool.capability === 'read' && !canRequireApproval(tool),
    destructiveHint: tool.capability === 'write',
    openWorldHint: tool.capability === 'net',
  }
}

export function exposedToolNames(tools: ReadonlyMap<string, ToolDefinition>): readonly string[] {
  return [...tools].flatMap(([name, tool]) => (isMcpExposed(name, tool) ? [name] : []))
}

function isMcpExposed(name: string, tool: ToolDefinition): boolean {
  return !(
    isClientApprovalWithheld(name, tool) ||
    MCP_EXCLUDED_CAPABILITIES.has(tool.capability) ||
    MCP_TOOL_DENYLIST.has(name)
  )
}

export function buildServerInstructions(skillsCatalog: string): string {
  return `${MCP_SERVER_INSTRUCTIONS}${skillsCatalog}`
}

export function buildSkillsCatalog(skills: readonly SkillMeta[]): string {
  if (skills.length === 0) {
    return ''
  }

  const lines = skills
    .map((skill) => `- ${escapeXml(skill.name)}: ${escapeXml(skill.description)}`)
    .join('\n')

  return `\n\n<available_skills>\n${SKILL_CATALOG_GUIDANCE}\n${lines}\n</available_skills>`
}

import type { Capability, ToolDefinition } from '@/core/tool'

export const SOCIAL_REQUEST_TOOL = 'social_request'
export const SOCIAL_SKILL_TOOL = 'social_skill'

/** What a networked agent may hold with nothing in `[social] allowed_tools`: the two social tools,
 *  the suggestion trio, recall, the read-only market tools and the clock. Literal names, because
 *  `social/` may not import trading; boot asserts each one exists (`validateSocialTools`). */
const DEFAULT_SOCIAL_TOOLS: readonly string[] = Object.freeze([
  SOCIAL_REQUEST_TOOL,
  SOCIAL_SKILL_TOOL,
  'suggestion_run',
  'suggestion_batch',
  'suggestion_track_record',
  'market_price',
  'market_bars',
  'market_overview',
  'market_events',
  'market_accounts',
  'market_sector_strength',
  'market_news',
  'market_sentiment',
  'market_funding',
  'macro_risk',
  'vn_foreign_flow',
  'vn_futures_basis',
  'now',
  'calc',
])

/** An agent that reads strangers' posts must not hold anything that writes, runs, schedules or
 *  delegates, nor reach the operator's book, orders, files or mail. `*` is refused by name because
 *  a config that asks for every tool means it. */
const REFUSED_CAPABILITIES: ReadonlySet<Capability> = new Set([
  'write',
  'shell',
  'schedule',
  'delegate',
])
const REFUSED_TOOL_NAMES: ReadonlySet<string> = new Set([
  '*',
  'profile_view',
  'profile_update',
  'profile_segment',
  'watchlist_update',
  'alert_manage',
  'brief_build',
  'brief_manage',
  'memory_store',
  'memory_remove',
  'web_fetch',
  'ask_clarification',
  'todo_write',
])
const REFUSED_TOOL_PREFIXES: readonly string[] = ['portfolio_', 'order_', 'file_']

function isRefusedName(name: string): boolean {
  return REFUSED_TOOL_NAMES.has(name) || REFUSED_TOOL_PREFIXES.some((p) => name.startsWith(p))
}

function isRefusedTool(tool: ToolDefinition): boolean {
  return (
    isRefusedName(tool.name) ||
    REFUSED_CAPABILITIES.has(tool.capability) ||
    tool.isExternal === true
  )
}

/** The names in `[social] allowed_tools` refused by name alone, which config resolution rejects. */
export function refusedToolNames(names: readonly string[]): readonly string[] {
  return names.filter(isRefusedName)
}

/** Every tool a networked agent may hold: the defaults and the operator's additions, minus any
 *  registered tool the rules refuse. */
export function socialToolSet(
  allowed: readonly string[],
  tools: ReadonlyMap<string, ToolDefinition>
): ReadonlySet<string> {
  return new Set(
    [...DEFAULT_SOCIAL_TOOLS, ...allowed].filter((name) => {
      const tool = tools.get(name)

      return tool !== undefined && !isRefusedTool(tool)
    })
  )
}

/** The tools an agent holds that the rules do not allow. */
export function toolsOutsideRules(
  agentTools: readonly string[],
  allowedSet: ReadonlySet<string>
): readonly string[] {
  return agentTools.filter((name) => !allowedSet.has(name))
}

interface SocialToolIssues {
  /** Default names the registry lacks: a build defect, not the operator's. */
  readonly missing: readonly string[]
  /** Added names that are unknown, or refused by their capability or for being external. */
  readonly refused: readonly string[]
}

/** What is wrong with the rules against the final registry. */
export function validateSocialTools(
  allowed: readonly string[],
  tools: ReadonlyMap<string, ToolDefinition>
): SocialToolIssues {
  const missing = DEFAULT_SOCIAL_TOOLS.filter((name) => !tools.has(name))
  const refused = allowed.filter((name) => {
    const tool = tools.get(name)

    return tool === undefined || isRefusedTool(tool)
  })

  return { missing, refused }
}

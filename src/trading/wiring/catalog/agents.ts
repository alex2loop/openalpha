import type { ResolvedConfig } from '@/core/config/resolve'
import type { AgentProfile } from '@/engine/api'
import type { DebateRole } from '@/trading/kernel/config'
import { ConfigError } from '@/core/errors'
import { loadAgentFromText } from '@/engine/api'
// Imported as text, not read from disk, so `bun build --compile` embeds the personas in the binary.
import bearResearcherToml from '@/trading/agents/bear-researcher/agent.toml' with { type: 'text' }
import bullResearcherToml from '@/trading/agents/bull-researcher/agent.toml' with { type: 'text' }
import claimVerifierToml from '@/trading/agents/claim-verifier/agent.toml' with { type: 'text' }
import marketAnalystToml from '@/trading/agents/market-analyst/agent.toml' with { type: 'text' }
import portfolioManagerToml from '@/trading/agents/portfolio-manager/agent.toml' with {
  type: 'text',
}
import riskAnalystToml from '@/trading/agents/risk-analyst/agent.toml' with { type: 'text' }
import themeAnalystToml from '@/trading/agents/theme-analyst/agent.toml' with { type: 'text' }
import traderToml from '@/trading/agents/trader/agent.toml' with { type: 'text' }
import {
  DEBATE_MODE_ROLES,
  DEBATE_MODEL_TIER,
  THEME_ANALYST_AGENT_ID,
  THEME_MODEL_TIER,
} from '@/trading/kernel/config'

/** Keyed by `DebateRole`, so a role the pipeline can schedule cannot lack a persona. No entry
 *  declares a model or a turn cap: every role prefers the `debate` tier when one is configured,
 *  otherwise the operator's primary chain, and takes the resolved trading turn cap. The theme
 *  analyst is loaded beside them and prefers the `themes` tier. */
const REASONING_RE = /^reasoning\s*=\s*"(\w+)"/m

const TRADING_AGENT_SOURCES: Readonly<Record<DebateRole, string>> = Object.freeze({
  'bull-researcher': bullResearcherToml,
  'bear-researcher': bearResearcherToml,
  'portfolio-manager': portfolioManagerToml,
  trader: traderToml,
  'risk-analyst': riskAnalystToml,
  'claim-verifier': claimVerifierToml,
  'market-analyst': marketAnalystToml,
})

export function buildTradingAgents(
  config: ResolvedConfig,
  allToolNames: readonly string[]
): ReadonlyMap<string, AgentProfile> {
  const ctx = { config, allToolNames, trusted: true, preferredModelTier: DEBATE_MODEL_TIER }
  const agents = new Map<string, AgentProfile>()

  for (const [role, toml] of Object.entries(TRADING_AGENT_SOURCES)) {
    const agent = loadAgentFromText(toml, role, ctx)

    if (agents.has(agent.id)) {
      throw new ConfigError(`duplicate trading agent '${agent.id}'`)
    }

    agents.set(agent.id, { ...agent, internal: true })
  }

  const themeAnalyst = loadAgentFromText(themeAnalystToml, THEME_ANALYST_AGENT_ID, {
    ...ctx,
    preferredModelTier: THEME_MODEL_TIER,
  })

  if (agents.has(themeAnalyst.id) || themeAnalyst.id !== THEME_ANALYST_AGENT_ID) {
    throw new ConfigError(`theme analyst persona must be '${THEME_ANALYST_AGENT_ID}', once`)
  }

  agents.set(themeAnalyst.id, { ...themeAnalyst, internal: true })
  assertEveryDebateRoleBound(agents)

  return agents
}

/** `role@effort` for every persona, hashed into the calculation versions so a change of reasoning
 *  effort separates recorded populations exactly as a skill edit does. Read off the declarations
 *  rather than the built registry, because the registry needs the tool names and services are
 *  composed while those are still being collected. The model is deliberately absent: a fallback
 *  chain can switch mid-run, so no single name describes what argued. */
export function personaVersions(): readonly string[] {
  return Object.entries(TRADING_AGENT_SOURCES)
    .map(([role, toml]) => `${role}@${REASONING_RE.exec(toml)?.[1] ?? 'default'}`)
    .sort()
}

function assertEveryDebateRoleBound(agents: ReadonlyMap<string, AgentProfile>): void {
  const missing = Object.values(DEBATE_MODE_ROLES)
    .flat()
    .filter((role) => !agents.has(role))

  if (missing.length > 0) {
    throw new ConfigError(`debate roles without a persona: ${[...new Set(missing)].join(', ')}`)
  }
}

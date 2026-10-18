import type { ResearchStageId, ResolvedConfig } from '@/core/config/resolve'
import type { AgentProfile } from '@/engine/types/agent'
import { BRAND } from '@/core/brand'
import { ConfigError } from '@/core/errors'
import { type AgentBuildContext, loadAgentFromText } from '@/engine/agents/builder'
import { DELEGATE_MODEL_TIER } from '@/engine/constants'
import {
  RESEARCH_CRAWLER_ID,
  RESEARCH_HEAVY_MODEL_TIER,
  RESEARCH_MODEL_TIER,
  RESEARCH_WORKER_IDS,
} from '@/engine/research/contracts'

// Imported as text, not read from disk, so `bun build --compile` embeds the prompts in the binary.
import chatToml from './chat/agent.toml' with { type: 'text' }
import deepResearcherToml from './deep-researcher/agent.toml' with { type: 'text' }
import researchCrawlerToml from './research-crawler/agent.toml' with { type: 'text' }
import researchPlannerToml from './research-planner/agent.toml' with { type: 'text' }
import researchReviewerToml from './research-reviewer/agent.toml' with { type: 'text' }
import researchSynthesizerToml from './research-synthesizer/agent.toml' with { type: 'text' }
import reviewerToml from './reviewer/agent.toml' with { type: 'text' }

export const DEEP_RESEARCHER_ID = 'deep-researcher'

// Deterministic listing order: entry agents, internal workers, then the generic specialist.
const BUILT_IN_AGENT_IDS = ['chat', DEEP_RESEARCHER_ID, ...RESEARCH_WORKER_IDS, 'reviewer'] as const

// A ratchet, not a budget: the prompt is sent once per run and cached, so the cost of a line is
// not the reason to keep it out - crowding the rules that are already there is. Raise it only
// alongside the line being added, never to leave room for the next one.
const CHAT_PROMPT_MAX_CHARS = 4_925

type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[number]

interface BuiltInAgentSource {
  readonly toml: string
  readonly displayName?: string
  readonly maxPromptChars?: number
  readonly preferredModelTier?: string
}

// Research stage reasoning/max_tokens is fixed research policy (`RESEARCH_LIMITS.stages`), applied
// at build time: it overrides whatever the worker's agent.toml declares.
const RESEARCH_STAGE_BY_AGENT_ID: Readonly<Partial<Record<BuiltInAgentId, ResearchStageId>>> = {
  'research-planner': 'planner',
  [RESEARCH_CRAWLER_ID]: 'crawler',
  'research-synthesizer': 'synthesizer',
  'research-reviewer': 'reviewer',
}

const BUILT_IN_SOURCES: Readonly<Record<BuiltInAgentId, BuiltInAgentSource>> = {
  chat: {
    toml: chatToml,
    displayName: BRAND.display,
    maxPromptChars: CHAT_PROMPT_MAX_CHARS,
  },
  [DEEP_RESEARCHER_ID]: { toml: deepResearcherToml, preferredModelTier: RESEARCH_MODEL_TIER },
  [RESEARCH_CRAWLER_ID]: {
    toml: researchCrawlerToml,
    preferredModelTier: RESEARCH_HEAVY_MODEL_TIER,
  },
  'research-planner': { toml: researchPlannerToml, preferredModelTier: RESEARCH_MODEL_TIER },
  'research-reviewer': { toml: researchReviewerToml, preferredModelTier: RESEARCH_MODEL_TIER },
  'research-synthesizer': {
    toml: researchSynthesizerToml,
    preferredModelTier: RESEARCH_MODEL_TIER,
  },
  reviewer: { toml: reviewerToml, preferredModelTier: DELEGATE_MODEL_TIER },
}

export function buildBuiltInAgents(
  config: ResolvedConfig,
  allToolNames: readonly string[]
): ReadonlyMap<string, AgentProfile> {
  const ctx = { config, allToolNames, trusted: true }
  const agents = new Map<string, AgentProfile>()

  for (const id of BUILT_IN_AGENT_IDS) {
    agents.set(id, buildBuiltInAgent(id, ctx))
  }

  return agents
}

function buildBuiltInAgent(id: BuiltInAgentId, ctx: AgentBuildContext): AgentProfile {
  const source = BUILT_IN_SOURCES[id]
  const agentCtx: AgentBuildContext =
    source.preferredModelTier === undefined
      ? ctx
      : { ...ctx, preferredModelTier: source.preferredModelTier }
  const agent = applyResearchStageTuning(
    id,
    loadAgentFromText(source.toml, id, agentCtx),
    ctx.config
  )

  if (source.maxPromptChars !== undefined && agent.systemPrompt.length > source.maxPromptChars) {
    throw new ConfigError(`agent '${id}' prompt exceeds ${source.maxPromptChars} characters`)
  }

  return source.displayName === undefined ? agent : { ...agent, name: source.displayName }
}

function applyResearchStageTuning(
  id: BuiltInAgentId,
  agent: AgentProfile,
  config: ResolvedConfig
): AgentProfile {
  const stageId = RESEARCH_STAGE_BY_AGENT_ID[id]

  if (stageId === undefined) {
    return agent
  }

  const stage = config.research.stages[stageId]
  return { ...agent, reasoningMode: stage.reasoning, maxTokens: stage.maxTokens }
}

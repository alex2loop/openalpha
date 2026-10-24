import { parse as parseToml } from 'smol-toml'
import { z } from 'zod'

import type { ResolvedConfig, ResolvedModel } from '@/core/config/resolve'
import type { ReasoningMode } from '@/core/llm'
import type { AgentModelChain, AgentProfile } from '@/engine/types/agent'
import { providerById } from '@/ai/api'
import { isClientModelSource } from '@/core/config/resolve'
import { ConfigError } from '@/core/errors'
import { agentId, isPathId } from '@/core/ids'
import { REASONING_MODES } from '@/core/llm'
import { hasBlockingThreat, scanSkill } from '@/core/security/sanitize'
import { MAX_TIMER_MS } from '@/core/utils/time'
import { MAX_SPAWN_PER_AGENT, SPAWN_TOOL_NAME } from '@/engine/constants'

export const RESERVED_AGENT_IDS: ReadonlySet<string> = new Set(['default'])
export const ALL_TOOLS = '*'

/** Either every registered tool or a named subset. Omitting the grant denies all. */
export type ToolGrant = typeof ALL_TOOLS | readonly string[]

const RawTableSchema = z.record(z.string(), z.unknown())

const AgentTomlSchema = z.strictObject({
  id: z.string().optional(),
  name: z.string().optional(),
  system_prompt: z.string().min(1),
  description: z.string().optional(),
  model_tier: z.string().min(1).optional(),
  reasoning: z.enum(REASONING_MODES).optional(),
  max_turns: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  max_duration_ms: z.number().int().positive().max(MAX_TIMER_MS).optional(),
  focus: RawTableSchema.optional(),
  max_daily_usd: z.number().nonnegative().optional(),
  capabilities: z
    .strictObject({
      tools: z.union([z.literal(ALL_TOOLS), z.array(z.string())]).optional(),
      delegates: z.array(z.string()).optional(),
      max_spawn: z.number().int().min(0).max(MAX_SPAWN_PER_AGENT).optional(),
      hosts: z.array(z.string().min(1)).optional(),
      skills: z.array(z.string().min(1)).optional(),
    })
    .optional(),
})

export type AgentToml = z.infer<typeof AgentTomlSchema>

/** One owner for the agent DTO schema: TOML text and code-defined values both pass through here. */
export function parseAgentTomlObject(raw: unknown, name: string): AgentToml {
  const parsed = AgentTomlSchema.safeParse(raw)

  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ConfigError(
      `agent '${name}' agent.toml is invalid: ${issue?.path.join('.')} ${issue?.message}`
    )
  }

  return parsed.data
}

export interface AgentBuildContext {
  readonly config: ResolvedConfig
  readonly allToolNames: readonly string[]
  /** A plugin loader passes `bundledIds.has(plugin.id)`, as `plugins/merge.ts` does for code. */
  readonly trusted: boolean
  /** Lets an untrusted profile name a configured model tier; `reasoning` stays trusted-only. */
  readonly allowModelTier?: true
  readonly preferredModelTier?: string
}

/** Reference check input: the definition's id/references plus the fully assembled name sets. */
export interface AgentReferenceIssuesInput {
  readonly id: string
  readonly toolNames: readonly string[]
  readonly agentIds: readonly string[]
  readonly tools?: ToolGrant
  readonly delegates?: readonly string[]
}

/**
 * Pure reference validator. Preserves reference order and returns every problem, so boot can
 * aggregate all issues across every candidate before throwing once. One implementation: the
 * builder's throwing guard and the app lowering both go through here.
 */
export function collectAgentReferenceIssues(input: AgentReferenceIssuesInput): readonly string[] {
  const { id, toolNames, agentIds } = input
  const knownTools = new Set(toolNames)
  const knownAgents = new Set(agentIds)
  const issues: string[] = []

  // `*` names the registry itself, so it has nothing to resolve.
  for (const name of input.tools === ALL_TOOLS ? [] : (input.tools ?? [])) {
    if (!knownTools.has(name)) {
      issues.push(`agent '${id}' references unknown tool '${name}'`)
    }
  }

  for (const delegate of input.delegates ?? []) {
    if (!knownAgents.has(delegate)) {
      issues.push(`agent '${id}' references unknown delegate '${delegate}'`)
    }
  }

  return issues
}

interface AgentModelSelection {
  readonly primary: ResolvedModel
  readonly chain: AgentModelChain
}

interface ResolveAgentModelInput {
  readonly parsed: AgentToml
  readonly id: string
  readonly ctx: AgentBuildContext
  readonly hasTools: boolean
}

interface ResolveTierInput {
  readonly tierName: string
  readonly id: string
  readonly config: ResolvedConfig
  readonly hasTools: boolean
}

export function loadAgentFromText(raw: string, name: string, ctx: AgentBuildContext): AgentProfile {
  return buildAgentFromToml(parseAgentToml(raw, name), name, ctx)
}

export function assertValidAgentToml(raw: string, name: string): void {
  parseAgentToml(raw, name)
}

/** Ensures a file-backed agent cannot claim a different registry identity than its source. */
export function assertAgentTomlMatchesSourceId(raw: string, sourceId: string): void {
  const parsed = parseAgentToml(raw, sourceId)
  const declaredId = parsed.id ?? sourceId

  if (declaredId !== sourceId) {
    throw new ConfigError(
      `agent '${sourceId}' agent.toml declares id '${declaredId}', expected '${sourceId}'`
    )
  }
}

export function buildAgentFromToml(
  parsed: AgentToml,
  name: string,
  ctx: AgentBuildContext
): AgentProfile {
  const id = parsed.id ?? name

  assertAgentIdAllowed(id)
  assertSystemPromptAllowed(parsed.system_prompt, id, ctx)
  assertMaxDailyUsd(parsed.max_daily_usd, ctx.config.budget.maxDailyUsd, id)

  const maxSpawn = parsed.capabilities?.max_spawn ?? 0
  const tools = resolveToolGrant(parsed.capabilities?.tools, ctx.allToolNames, maxSpawn)
  const selected = resolveAgentModelChain({
    parsed,
    id,
    ctx,
    hasTools: tools.length > 0,
  })

  assertToolReferencesValid(id, tools, ctx.allToolNames)

  return {
    id: agentId(id),
    name: parsed.name ?? id,
    ...(parsed.description === undefined ? {} : { description: parsed.description }),
    systemPrompt: parsed.system_prompt,
    model: selected.primary.model,
    preferredProviderModel: {
      provider: selected.primary.provider,
      model: selected.primary.model,
    },
    modelChain: selected.chain,
    reasoningMode: resolveAgentReasoning(parsed, id, ctx),
    tools,
    maxTurns: parsed.max_turns ?? ctx.config.loop.maxTurns,
    ...(parsed.max_tokens === undefined ? {} : { maxTokens: parsed.max_tokens }),
    ...(parsed.max_duration_ms === undefined ? {} : { maxDurationMs: parsed.max_duration_ms }),
    ...(parsed.focus === undefined ? {} : { focus: Object.freeze({ ...parsed.focus }) }),
    ...(isOwnCap(parsed.max_daily_usd) ? { maxDailyUsd: parsed.max_daily_usd } : {}),
    delegates: parsed.capabilities?.delegates ?? [],
    ...(maxSpawn > 0 ? { maxSpawn } : {}),
    ...(parsed.capabilities?.hosts === undefined ? {} : { hosts: parsed.capabilities.hosts }),
    ...(parsed.capabilities?.skills === undefined ? {} : { skills: parsed.capabilities.skills }),
  }
}

function isOwnCap(value: number | undefined): value is number {
  return value !== undefined && value > 0
}

function assertMaxDailyUsd(value: number | undefined, operatorCapUsd: number, id: string): void {
  if (isOwnCap(value) && operatorCapUsd > 0 && value > operatorCapUsd) {
    throw new ConfigError(
      `agent '${id}' max_daily_usd ${value} is above [budget] max_daily_usd ${operatorCapUsd}`
    )
  }
}

function resolveAgentReasoning(
  parsed: AgentToml,
  id: string,
  ctx: AgentBuildContext
): ReasoningMode {
  if (parsed.reasoning === undefined) {
    return 'default'
  }

  if (!ctx.trusted) {
    throw new ConfigError(`agent '${id}': reasoning is not allowed for untrusted profiles`)
  }

  return parsed.reasoning
}

// An agent that never named a tool gets none: a file with no grant must not inherit the registry.
// `*` leaves out `spawn` for an agent that may not spawn, so a tool that only refuses is never offered.
function resolveToolGrant(
  grant: ToolGrant | undefined,
  allToolNames: readonly string[],
  maxSpawn: number
): readonly string[] {
  if (grant !== ALL_TOOLS) {
    return grant ?? []
  }

  return maxSpawn > 0 ? allToolNames : allToolNames.filter((name) => name !== SPAWN_TOOL_NAME)
}

/** The builder's throwing guard wraps the engine-owned reference collector (one implementation). */
function assertToolReferencesValid(
  id: string,
  tools: readonly string[],
  allToolNames: readonly string[]
): void {
  const input: AgentReferenceIssuesInput = {
    id,
    toolNames: allToolNames,
    agentIds: [],
    tools: tools,
  }
  const issues = collectAgentReferenceIssues(input)
  const first = issues[0]

  if (first !== undefined) {
    throw new ConfigError(first)
  }
}

function parseAgentToml(raw: string, name: string): AgentToml {
  return parseAgentTomlObject(parseToml(raw), name)
}

/** The loader's own rule, so a scaffolded agent is one it will accept. */
export function isValidAgentId(id: string): boolean {
  return isPathId(id)
}

function assertAgentIdAllowed(id: string): void {
  if (!isValidAgentId(id)) {
    throw new ConfigError(
      `agent id '${id}' must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores, hyphens, or dots (max 64)`
    )
  }

  if (RESERVED_AGENT_IDS.has(id)) {
    throw new ConfigError(`agent id '${id}' is reserved; rename it`)
  }
}

// A system prompt is instruction text the model treats as authoritative, so an untrusted profile
// gets the same scan a plugin-contributed skill does.
function assertSystemPromptAllowed(prompt: string, id: string, ctx: AgentBuildContext): void {
  if (ctx.trusted) {
    return
  }

  if (hasBlockingThreat(scanSkill(prompt))) {
    throw new ConfigError(`agent '${id}': system_prompt contains a blocked instruction pattern`)
  }
}

function resolveAgentModelChain(input: ResolveAgentModelInput): AgentModelSelection {
  const { parsed, id, ctx, hasTools } = input

  if (parsed.model_tier !== undefined) {
    if (!ctx.trusted && ctx.allowModelTier !== true) {
      throw new ConfigError(`agent '${id}': model_tier is not allowed for untrusted profiles`)
    }

    if (ctx.preferredModelTier !== undefined && ctx.preferredModelTier !== parsed.model_tier) {
      throw new ConfigError(
        `agent '${id}': explicit model_tier conflicts with composition preference`
      )
    }
  }

  // The client's model answers every agent; a configured tier serves only lookups that name it.
  if (isClientModelSource(ctx.config.modelSource)) {
    return primarySelection(ctx.config)
  }

  if (parsed.model_tier !== undefined) {
    return resolveTier({
      tierName: parsed.model_tier,
      id,
      config: ctx.config,
      hasTools,
    })
  }

  if (
    ctx.preferredModelTier !== undefined &&
    ctx.config.modelTiers[ctx.preferredModelTier] !== undefined
  ) {
    return resolveTier({
      tierName: ctx.preferredModelTier,
      id,
      config: ctx.config,
      hasTools,
    })
  }

  return primarySelection(ctx.config)
}

function primarySelection(config: ResolvedConfig): AgentModelSelection {
  return { primary: primaryModel(config), chain: { kind: 'primary' } }
}

function resolveTier(input: ResolveTierInput): AgentModelSelection {
  const { tierName, id, config, hasTools } = input
  const tier = config.modelTiers[tierName]

  if (tier === undefined || tier.length === 0) {
    throw new ConfigError(`agent '${id}': model_tier '${tierName}' is not configured`)
  }

  if (hasTools) {
    assertTierSupportsTools(tier, tierName, id)
  }

  const primary = tier.at(0)

  if (primary === undefined) {
    throw new ConfigError(`agent '${id}': model_tier '${tierName}' has no entries`)
  }

  return {
    primary,
    chain: { kind: 'tier', name: tierName },
  }
}

function assertTierSupportsTools(
  tier: readonly ResolvedModel[],
  tierName: string,
  id: string
): void {
  for (const entry of tier) {
    if (!providerById(entry.provider).supportsTools) {
      throw new ConfigError(
        `agent '${id}': model_tier '${tierName}' entry ${entry.provider}/${entry.model} does not support tools`
      )
    }
  }
}

function primaryModel(config: ResolvedConfig): ResolvedModel {
  const model = config.models[0]

  if (model === undefined) {
    throw new ConfigError('no models configured')
  }

  return model
}

import type { Exact } from '@/core/types/exact'
import type { AgentToml, ToolGrant } from '@/engine/agents/builder'
import type { AgentProfile } from '@/engine/types/agent'
import { ValidationError } from '@/core/errors'
import { collectUnknownKeys, formatKeys, isPlainRecord } from '@/core/utils/collections'
import {
  type AgentBuildContext,
  ALL_TOOLS,
  buildAgentFromToml,
  isValidAgentId,
  parseAgentTomlObject,
  RESERVED_AGENT_IDS,
} from '@/engine/agents/builder'

// Trust-gated fields cannot appear on a code-defined agent. Compile-time callers are blocked by
// `Exact`; these names catch JavaScript callers and any DTO-spelling attempt with one policy error.
const FORBIDDEN_TRUST_FIELDS: ReadonlyMap<string, string> = new Map<string, string>([
  ['modelTier', 'modelTier is set by composition, not by a code-defined agent'],
  ['model_tier', 'model_tier is set by composition, not by a code-defined agent'],
  ['reasoning', 'reasoning policy is set by composition, not by a code-defined agent'],
])

// Keys allowed on the top-level definition object (capabilities handled separately).
const ALLOWED_KEYS: ReadonlySet<string> = new Set<string>([
  'id',
  'name',
  'description',
  'systemPrompt',
  'maxTurns',
  'maxTokens',
  'maxDurationMs',
  'capabilities',
])

// Keys allowed inside `capabilities`.
const ALLOWED_CAPABILITY_KEYS: ReadonlySet<string> = new Set<string>([
  'tools',
  'delegates',
  'hosts',
  'skills',
])

export interface AgentCapabilities {
  readonly tools?: ToolGrant
  readonly delegates?: readonly string[]
  readonly hosts?: readonly string[]
  readonly skills?: readonly string[]
}

export interface AgentDefinition {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly systemPrompt: string
  readonly maxTurns?: number
  readonly maxTokens?: number
  readonly maxDurationMs?: number
  readonly capabilities?: AgentCapabilities
}

/** Engine-internal build context for a code-defined agent; trust state is structurally absent. */
export interface AgentDefinitionContext {
  readonly config: AgentBuildContext['config']
  readonly allToolNames: readonly string[]
}

/**
 * Author-time factory. Validates the id policy, rejects unknown and trust-gated keys, checks the
 * system prompt is non-empty, and returns a deeply frozen definition. Container-time validation
 * (unknown tool/delegate references) is deferred to boot, where the assembled registries exist.
 */
export function createAgent(def: Exact<AgentDefinition, AgentDefinition>): AgentDefinition {
  if (!isPlainRecord(def)) {
    throw new ValidationError('createAgent requires a definition object')
  }

  assertNoForbiddenFields(def)
  const unknown = collectUnknownKeys(def, ALLOWED_KEYS)

  if (unknown.length > 0) {
    throw new ValidationError(`createAgent: unknown field(s) ${formatKeys(unknown)}`)
  }

  if (typeof def.id !== 'string' || def.id.trim() === '') {
    throw new ValidationError('createAgent: id must be a non-empty string')
  }

  if (!isValidAgentId(def.id) || RESERVED_AGENT_IDS.has(def.id)) {
    throw new ValidationError(
      `createAgent: id '${def.id}' is reserved or must match the agent-id policy`
    )
  }

  if (typeof def.systemPrompt !== 'string' || def.systemPrompt.trim() === '') {
    throw new ValidationError(`createAgent: systemPrompt must be a non-empty string`)
  }

  if (def.capabilities !== undefined) {
    assertCapabilitiesShape(def.id, def.capabilities)
  }

  return freezeDefinition(def)
}

/**
 * Engine-internal builder for a code-defined agent. Hard-pins `trusted: false`, converts the
 * camelCase definition through the shared `AgentTomlSchema` owner, and calls the canonical
 * `buildAgentFromToml`. App lowering must call this, not the TOML builder directly.
 */
export function buildAgentDefinition(
  def: AgentDefinition,
  ctx: AgentDefinitionContext
): AgentProfile {
  return buildAgentFromToml(toAgentToml(def), def.id, {
    config: ctx.config,
    allToolNames: ctx.allToolNames,
    trusted: false,
  })
}

function assertNoForbiddenFields(def: Record<string, unknown>): void {
  for (const key of Object.keys(def)) {
    const reason = FORBIDDEN_TRUST_FIELDS.get(key)

    if (reason !== undefined) {
      throw new ValidationError(`createAgent: ${reason}`)
    }
  }
}

function assertCapabilitiesShape(id: string, capabilities: unknown): void {
  if (!isPlainRecord(capabilities)) {
    throw new ValidationError(`createAgent: agent '${id}' capabilities must be an object`)
  }

  const unknown = collectUnknownKeys(capabilities, ALLOWED_CAPABILITY_KEYS)

  if (unknown.length > 0) {
    throw new ValidationError(
      `createAgent: agent '${id}' unknown capability field(s) ${formatKeys(unknown)}`
    )
  }

  assertToolGrant(id, capabilities.tools)
  assertStringArray(id, capabilities, 'delegates')
  assertStringArray(id, capabilities, 'hosts')
  assertStringArray(id, capabilities, 'skills')
}

function assertToolGrant(id: string, tools: unknown): void {
  if (tools === undefined || tools === ALL_TOOLS || isStringArray(tools)) {
    return
  }

  throw new ValidationError(
    `createAgent: agent '${id}' capabilities.tools must be string[] or '${ALL_TOOLS}'`
  )
}

function assertStringArray(
  id: string,
  capabilities: Record<string, unknown>,
  field: 'delegates' | 'hosts' | 'skills'
): void {
  const value = capabilities[field]

  if (value !== undefined && !isStringArray(value)) {
    throw new ValidationError(`createAgent: agent '${id}' capabilities.${field} must be string[]`)
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

// why-safe: every `assert*` above has already run against this `def`, so each field is present, of
// the declared type, and free of unknown keys. Nothing reaches here with an unvalidated definition.
function freezeDefinition(def: Record<string, unknown>): AgentDefinition {
  const capabilities = def.capabilities
  const frozenCapabilities =
    capabilities === undefined ? undefined : freezeCapabilities(capabilities as AgentCapabilities)

  return Object.freeze({
    id: def.id,
    ...(def.name === undefined ? {} : { name: def.name }),
    ...(def.description === undefined ? {} : { description: def.description }),
    systemPrompt: def.systemPrompt,
    ...(def.maxTurns === undefined ? {} : { maxTurns: def.maxTurns }),
    ...(def.maxTokens === undefined ? {} : { maxTokens: def.maxTokens }),
    ...(def.maxDurationMs === undefined ? {} : { maxDurationMs: def.maxDurationMs }),
    ...(frozenCapabilities === undefined ? {} : { capabilities: frozenCapabilities }),
  }) as AgentDefinition
}

function copyToolGrant(grant: ToolGrant): ToolGrant {
  return grant === ALL_TOOLS ? grant : [...grant]
}

function freezeCapabilities(capabilities: AgentCapabilities): AgentCapabilities {
  return Object.freeze({
    ...(capabilities.tools === undefined
      ? {}
      : { tools: Object.freeze(copyToolGrant(capabilities.tools)) }),
    ...(capabilities.delegates === undefined
      ? {}
      : { delegates: Object.freeze([...capabilities.delegates]) }),
    ...(capabilities.hosts === undefined ? {} : { hosts: Object.freeze([...capabilities.hosts]) }),
    ...(capabilities.skills === undefined
      ? {}
      : { skills: Object.freeze([...capabilities.skills]) }),
  })
}

// Convert the camelCase definition into the snake_case DTO and through the shared schema parser,
// so positive-integer and array validation have one owner. `trusted`, `model_tier`, and
// `reasoning` are deliberately absent — a code-defined agent is structurally untrusted.
function toAgentToml(def: AgentDefinition): AgentToml {
  const raw: Record<string, unknown> = {
    id: def.id,
    system_prompt: def.systemPrompt,
    ...(def.name === undefined ? {} : { name: def.name }),
    ...(def.description === undefined ? {} : { description: def.description }),
    ...(def.maxTurns === undefined ? {} : { max_turns: def.maxTurns }),
    ...(def.maxTokens === undefined ? {} : { max_tokens: def.maxTokens }),
    ...(def.maxDurationMs === undefined ? {} : { max_duration_ms: def.maxDurationMs }),
    ...(def.capabilities === undefined
      ? {}
      : { capabilities: toAgentTomlCapabilities(def.capabilities) }),
  }

  return parseAgentTomlObject(raw, def.id)
}

function toAgentTomlCapabilities(capabilities: AgentCapabilities): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  if (capabilities.tools !== undefined) {
    out.tools = copyToolGrant(capabilities.tools)
  }

  if (capabilities.delegates !== undefined) {
    out.delegates = [...capabilities.delegates]
  }

  if (capabilities.hosts !== undefined) {
    out.hosts = [...capabilities.hosts]
  }

  if (capabilities.skills !== undefined) {
    out.skills = [...capabilities.skills]
  }

  return out
}

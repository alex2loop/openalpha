import type { LLMRequest } from '@/core/llm'
import { isPlainRecord } from '@/core/utils/collections'

// OpenAI structured-outputs accepts only a JSON Schema subset: `anyOf` unions (never `oneOf`),
// every property listed in `required` (optional fields expressed as a union with `null`), and
// `additionalProperties: false` on every object. Contract schemas are authored in zod without
// those constraints, so the wire shape is derived here — an enforcing backend then guarantees
// conforming output instead of rejecting the contract outright.

// Routers that serve many vendors behind one model id. Some of their models (deepseek-v4-pro)
// answer an enforced schema on turn 1 instead of calling the tools they were handed, so a
// tool-bearing request keeps the local parser and its repair pass instead of the contract. A
// first-party endpoint resolves the pair the other way — the tool call wins and the schema shapes
// the final message — which is why this narrows to the routers rather than dropping every
// tool-bearing contract.
const SCHEMA_YIELDS_TO_TOOLS: ReadonlySet<string> = new Set(['openrouter'])
// Hosts that take JSON mode but refuse a schema with it.
const JSON_MODE_ONLY: ReadonlySet<string> = new Set(['deepseek'])

const NULL_SCHEMA: Readonly<Record<string, string>> = Object.freeze({ type: 'null' })
// A constrained-decoding backend compiles the schema into an automaton, and these keywords bound
// a value without shaping it: each multiplies the state count until Gemini rejects the contract
// ("too many states for serving"). The authored zod schema still enforces them at parse time.
const UNCONSTRAINED_KEYWORDS: ReadonlySet<string> = new Set([
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
])

/** Whether this request may carry an enforced schema, for both OpenAI transports. */
export function canEnforceContract(req: LLMRequest, providerId: string): boolean {
  return req.tools === undefined || req.tools.length === 0
    ? true
    : !SCHEMA_YIELDS_TO_TOOLS.has(providerId)
}

export function acceptsJsonSchema(providerId: string): boolean {
  return !JSON_MODE_ONLY.has(providerId)
}

export function toOpenAiStrictSubset(
  schema: Readonly<Record<string, unknown>>
): Record<string, unknown> {
  // why-safe: transformNode returns a plain object whenever its input is one, and the contract
  // root is always an object.
  return transformNode(schema) as Record<string, unknown>
}

function transformNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(transformNode)
  }
  if (!isPlainRecord(node)) {
    return node
  }

  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    // Keys under `properties` are field names, so a field named `pattern` must survive the filter.
    if (key === 'properties' && isPlainRecord(value)) {
      out.properties = mapValues(value, transformNode)
      continue
    }
    if (UNCONSTRAINED_KEYWORDS.has(key)) {
      continue
    }
    if (key === 'oneOf' && Array.isArray(value)) {
      out.anyOf = value.map(transformNode)
      continue
    }
    out[key] = transformNode(value)
  }

  return applyObjectConstraints(out)
}

function mapValues(
  node: Record<string, unknown>,
  transform: (value: unknown) => unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = transform(value)
  }
  return out
}

// Every property becomes required; a formerly-optional property is widened to a null union so the
// model may still mark it absent. `null` is stripped back out at parse time (research/schemas).
function applyObjectConstraints(node: Record<string, unknown>): Record<string, unknown> {
  if (node.type !== 'object' || !isPlainRecord(node.properties)) {
    return node
  }

  const declared = Array.isArray(node.required) ? node.required : []
  const required = new Set(declared.filter((name): name is string => typeof name === 'string'))
  const properties: Record<string, unknown> = {}

  for (const [name, prop] of Object.entries(node.properties)) {
    properties[name] = required.has(name) ? prop : { anyOf: [prop, NULL_SCHEMA] }
  }

  node.properties = properties
  node.required = Object.keys(properties)
  if (!('additionalProperties' in node)) {
    node.additionalProperties = false
  }
  return node
}

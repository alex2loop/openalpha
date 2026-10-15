// A decisions request rendered for a chat provider. The questions become an enforced JSON schema
// whose shape is the decisions answer itself, so a chat model and the decisions router answer the
// same caller identically. Asked in prose instead, a small model returns repeating text and no
// structure at all.
import type { DecisionQuery, LLMMessage, LLMRequest } from '@/core/llm'
import { acceptsJsonSchema } from '@/ai/adapters/openai/strict-schema'

const CHOICE = 'choice'
const STATEMENT = 'noul'
const PROBABILITY = Object.freeze({ type: 'number', minimum: 0, maximum: 1 })
// JSON mode holds the model to valid JSON only, so the shape travels in the prompt instead.
const JSON_MODE_INSTRUCTION = 'Reply with one JSON object matching this schema:'

interface ChatDecisions {
  readonly messages: readonly LLMMessage[]
  /** Absent for an ordinary conversation, which leaves the optional contract path to decide. */
  readonly responseFormat?: Readonly<Record<string, unknown>>
}

/** A request that carries no questions passes its own messages through unchanged. */
export function toChatDecisions(req: LLMRequest, providerId: string): ChatDecisions {
  const asked = req.decisions

  if (asked === undefined) {
    return { messages: req.messages }
  }

  const schema = toSchema(asked.queries)

  if (!acceptsJsonSchema(providerId)) {
    const content = `${toPrompt(asked)}\n\n${JSON_MODE_INSTRUCTION}\n${JSON.stringify(schema)}`

    return {
      messages: [{ role: 'user', content }],
      responseFormat: { type: 'json_object' },
    }
  }

  return {
    messages: [{ role: 'user', content: toPrompt(asked) }],
    responseFormat: {
      type: 'json_schema',
      json_schema: { name: 'decisions', strict: true, schema },
    },
  }
}

function toPrompt(asked: NonNullable<LLMRequest['decisions']>): string {
  const lines = Object.entries(asked.queries).map(([id, query]) =>
    query.kind === 'statement'
      ? `${id}: ${query.instructions}`
      : `${id}: ${query.instructions}\n${toCriteriaLines(query.criteria)}`
  )

  return [
    'State:',
    JSON.stringify(asked.state),
    '',
    'Answer every question against that state. For a set of options, give the one you believe and',
    'how sure you are from 0 to 1. For a single statement, give the probability it is true.',
    '',
    ...lines,
  ].join('\n')
}

function toCriteriaLines(criteria: Readonly<Record<string, string>>): string {
  return Object.entries(criteria)
    .map(([option, description]) => `  - ${option}: ${description}`)
    .join('\n')
}

function toSchema(queries: Readonly<Record<string, DecisionQuery>>): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(queries),
    properties: Object.fromEntries(
      Object.entries(queries).map(([id, query]) => [id, toProperty(query)])
    ),
  }
}

/** The property is the answer the caller already parses, discriminator included, so nothing between
 *  the model and the reader has to reshape it. */
function toProperty(query: DecisionQuery): Record<string, unknown> {
  if (query.kind === 'statement') {
    return {
      type: 'object',
      additionalProperties: false,
      required: ['type', STATEMENT],
      properties: { type: { const: STATEMENT }, [STATEMENT]: PROBABILITY },
    }
  }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['type', 'choice', 'confidence'],
    properties: {
      type: { const: CHOICE },
      choice: { type: 'string', enum: Object.keys(query.criteria) },
      confidence: PROBABILITY,
    },
  }
}

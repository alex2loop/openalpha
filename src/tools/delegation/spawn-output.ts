import { z } from 'zod'

import type { SpawnResult } from '@/tools/delegation/spawn-report'
import { ToolError } from '@/core/errors'

export const MAX_OUTPUT_SCHEMA_CHARS = 4_000

const JSON_FENCE_RE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i

export interface OutputContract {
  readonly schema: Record<string, unknown>
  readonly validator: z.ZodType
}

/** Compiles the caller's JSON Schema once, before any child starts, so a bad one costs nothing. */
export function toOutputContract(schema: Record<string, unknown>): OutputContract {
  if (JSON.stringify(schema).length > MAX_OUTPUT_SCHEMA_CHARS) {
    throw new ToolError(
      'invalid_input',
      `output_schema is longer than ${MAX_OUTPUT_SCHEMA_CHARS} characters`
    )
  }

  try {
    return { schema, validator: z.fromJSONSchema(schema) }
  } catch {
    throw new ToolError('invalid_input', 'output_schema is not a JSON Schema this tool can use')
  }
}

// A provider drops the output contract whenever tools are exposed, so the schema travels in the
// child's own prompt and is checked on its final text after the run.
export function toOutputPrompt(contract: OutputContract): string {
  return `OUTPUT FORMAT\nYour final message replaces the plain answer above: it is one JSON document and nothing else, no prose and no code fence, that satisfies this JSON Schema. Put the sources where the schema has room for them.\n${JSON.stringify(contract.schema)}`
}

/** A finished child's text becomes the parsed JSON, or a failure that names the first mismatch. */
export function checkChildOutput(result: SpawnResult, contract: OutputContract): SpawnResult {
  if (result.status !== 'done') {
    return result
  }

  const { role } = result
  const decoded = decode(result.text ?? '')
  const parsed = decoded.ok ? contract.validator.safeParse(decoded.value) : undefined

  if (parsed?.success === true) {
    return { role, status: 'done', json: parsed.data }
  }

  const issue = parsed?.error.issues[0]
  const detail =
    issue === undefined
      ? 'the answer is not valid JSON'
      : `${issue.path.join('.') || 'answer'}: ${issue.message}`

  return {
    role,
    status: 'failed',
    reason: 'error',
    text: `the answer did not match output_schema (${detail}); ask again if you still need it`,
  }
}

function decode(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim()

  try {
    return { ok: true, value: JSON.parse(JSON_FENCE_RE.exec(trimmed)?.[1] ?? trimmed) }
  } catch {
    return { ok: false }
  }
}

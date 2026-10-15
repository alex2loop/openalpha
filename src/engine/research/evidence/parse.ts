import { z } from 'zod'

import type { JsonOutputContract } from '@/core/llm'

const JSON_FENCE_RE = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```$/i
const FENCED_BLOCK_RE = /```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```/i

type ResearchParseResult<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'invalid'; readonly issues: readonly string[] }

type DecodedResearchPayload =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'invalid'; readonly issue: string }

/** A provider enforces an output contract only on a request carrying no tools: a constrained model
 *  answers the schema instead of calling them, so the adapters drop the constraint whenever tools
 *  are exposed (adapters/openai/responses.ts). A run that answers unparseably is therefore re-asked
 *  once with this allowlist, which is the one request shape the schema is guaranteed on. */
export const CONTRACT_REPAIR_TOOLS: readonly string[] = Object.freeze([])

export function toResearchOutputContract<T>(
  name: string,
  schema: z.ZodType<T>
): JsonOutputContract {
  return Object.freeze({
    name,
    schema: Object.freeze(z.toJSONSchema(schema, { io: 'output' })),
    strict: true,
  })
}

export function parseResearchJson<T>(schema: z.ZodType<T>, raw: string): ResearchParseResult<T> {
  const decoded = decodeResearchPayload(raw)
  if (decoded.kind === 'invalid') {
    return { kind: 'invalid', issues: [decoded.issue] }
  }

  const parsed = schema.safeParse(decoded.value)
  if (parsed.success) {
    return { kind: 'value', value: parsed.data }
  }

  return {
    kind: 'invalid',
    issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
  }
}

export function decodeResearchPayload(raw: string): DecodedResearchPayload {
  try {
    return { kind: 'value', value: stripNulls(JSON.parse(extractJsonText(raw))) }
  } catch {
    return { kind: 'invalid', issue: 'output is not valid JSON' }
  }
}

// Models often wrap the payload in prose commentary ("Đã đủ thông tin…\n\n{...}"): accept a
// whole-text document, then a fenced block anywhere, then the outermost brace span.
function extractJsonText(raw: string): string {
  const trimmed = raw.trim()
  const wholeFence = JSON_FENCE_RE.exec(trimmed)

  if (wholeFence?.[1] !== undefined) {
    return wholeFence[1]
  }

  const fenced = FENCED_BLOCK_RE.exec(trimmed)

  if (fenced?.[1] !== undefined) {
    return fenced[1]
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')

  return start !== -1 && end > start ? trimmed.slice(start, end + 1) : trimmed
}

// Enforcing backends emit `null` for every optional field (the strict subset forbids absence);
// the research schemas treat those fields as omittable, and none uses null as a meaningful value.
function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripNulls)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}

    const entries: readonly (readonly [string, unknown])[] = Object.entries(value)

    for (const [key, val] of entries) {
      if (val !== null) {
        out[key] = stripNulls(val)
      }
    }
    return out
  }

  return value
}

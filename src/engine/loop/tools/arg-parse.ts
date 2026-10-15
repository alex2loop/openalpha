import type { ZodType } from 'zod'

import { toToolParameters } from '@/core/tool'
import { isPlainRecord } from '@/core/utils/collections'

const EXPECTED_FIELDS_PREFIX = 'Expected fields: '

/** The slice of a Zod issue the repair reads. */
interface TypeIssue {
  readonly code: string
  readonly path: readonly PropertyKey[]
  readonly message: string
  readonly expected?: string
}

type ToolInputParse<I> =
  | { readonly kind: 'value'; readonly input: I }
  | { readonly kind: 'error'; readonly details: string }

export function parseToolInput<I>(schema: ZodType<I>, args: unknown): ToolInputParse<I> {
  const first = schema.safeParse(args)

  if (first.success) {
    return { kind: 'value', input: first.data }
  }

  const repaired = repairStringifiedFields(args, first.error.issues)

  if (repaired === undefined) {
    return { kind: 'error', details: toDetails(first.error.issues, schema) }
  }

  const second = schema.safeParse(repaired)

  return second.success
    ? { kind: 'value', input: second.data }
    : { kind: 'error', details: toDetails(second.error.issues, schema) }
}

/** A model that cannot nest sends a whole object argument as one JSON string, then repeats the
 *  identical call until the loop detector closes its tools. Only a field the schema itself asked
 *  to be an object is reparsed, so a string argument that merely looks like JSON is left alone. */
function repairStringifiedFields(
  args: unknown,
  issues: readonly TypeIssue[]
): Record<string, unknown> | undefined {
  if (!isPlainRecord(args)) {
    return undefined
  }

  const repaired = { ...args }
  let isChanged = false

  for (const issue of issues) {
    const field = issue.path[0]

    if (typeof field !== 'string' || !isStructureIssue(issue)) {
      continue
    }

    const value = repaired[field]
    const parsed = typeof value === 'string' ? parseStructure(value) : undefined

    if (parsed !== undefined) {
      repaired[field] = parsed
      isChanged = true
    }
  }

  return isChanged ? repaired : undefined
}

function isStructureIssue(issue: TypeIssue): boolean {
  return (
    issue.code === 'invalid_type' &&
    issue.path.length === 1 &&
    (issue.expected === 'object' || issue.expected === 'array')
  )
}

function parseStructure(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)

    return isPlainRecord(parsed) || Array.isArray(parsed) ? parsed : undefined
  } catch {
    // Not JSON, so the schema's own issue is the one worth reporting.
    return undefined
  }
}

function toDetails<I>(issues: readonly TypeIssue[], schema: ZodType<I>): string {
  const problems = issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  const expected = expectedFields(schema)

  return expected === undefined ? problems : `${problems}. ${EXPECTED_FIELDS_PREFIX}${expected}`
}

/** `ticker (string, required), market (string)` from the root object's properties; undefined for a
 *  union root, whose arms the issue list already names. Runs only on the error path, and only for a
 *  schema that already converted once at registry build, so it cannot throw here. */
function expectedFields<I>(schema: ZodType<I>): string | undefined {
  const parameters = toToolParameters(schema)
  const properties = parameters.properties
  const required = Array.isArray(parameters.required)
    ? new Set<unknown>(parameters.required)
    : new Set<unknown>()

  if (!isPlainRecord(properties)) {
    return undefined
  }

  return Object.entries(properties)
    .map(([name, property]) => {
      const type =
        isPlainRecord(property) && typeof property.type === 'string' ? property.type : 'value'

      return required.has(name) ? `${name} (${type}, required)` : `${name} (${type})`
    })
    .join(', ')
}

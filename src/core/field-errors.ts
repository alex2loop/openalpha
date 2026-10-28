import type { z } from 'zod'

import type { OperatorMessage } from '@/core/types/operator-message'
import { ValidationError } from '@/core/errors'

const ISSUE_KEY_PREFIX = 'errors.fields.'
const WHOLE_BODY = 'body'

/** One refused field: where it sits in what the caller sent (`quantity`, `instrument.ticker`; empty
 *  for the whole body) and what to tell the operator about it. */
interface FieldIssue {
  readonly path: string
  readonly message: OperatorMessage
}

/** A field's name as the operator reads it: a catalog key, and the path as written where the
 *  catalog has none. */
export interface FieldLabel {
  readonly key: string
  readonly fallback: string
}

/** A request refused for what is wrong with named fields, so a form can mark each one. The first
 *  field's sentence stands for the whole where a surface has room for only one. */
export class FieldValidationError extends ValidationError {
  readonly fields: readonly FieldIssue[]

  constructor(message: string, fields: readonly FieldIssue[]) {
    super(message, fields[0]?.message)
    this.fields = fields
  }
}

/** A refused body, one field per zod issue, each with the sentence for it. The message the log
 *  keeps is English and names the same paths. A custom issue names its own sentence with
 *  `params: { kind }` (a key under `errors.fields`). */
export function toFieldValidationError(
  error: z.ZodError,
  subject: string,
  labelOf: (path: string) => FieldLabel
): FieldValidationError {
  const detail = error.issues
    .map((issue) => `${toPath(issue) || WHOLE_BODY}: ${issue.message}`)
    .join('; ')

  return new FieldValidationError(
    `invalid ${subject}: ${detail}`,
    error.issues.map((issue) => toFieldIssue(issue, labelOf))
  )
}

function toFieldIssue(issue: z.core.$ZodIssue, labelOf: (path: string) => FieldLabel): FieldIssue {
  const path = toPath(issue)

  return {
    path,
    message: {
      key: `${ISSUE_KEY_PREFIX}${toIssueKind(issue)}`,
      params: toIssueParams(issue, labelOf(path)),
    },
  }
}

function toPath(issue: z.core.$ZodIssue): string {
  return issue.path.map(String).join('.')
}

/** Every code a body schema raises has its own sentence; one it does not know reads as invalid. */
function toIssueKind(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'too_small':
      if (issue.origin === 'string') {
        return 'too_small_string'
      }

      return issue.inclusive === false ? 'too_small_exclusive' : 'too_small'

    case 'too_big':
    case 'invalid_type':
    case 'invalid_value':
    case 'invalid_union':
    case 'unrecognized_keys':
      return issue.code

    case 'custom': {
      const kind = issue.params?.kind

      return typeof kind === 'string' ? kind : 'custom'
    }

    default:
      return 'custom'
  }
}

function toIssueParams(
  issue: z.core.$ZodIssue,
  field: FieldLabel
): NonNullable<OperatorMessage['params']> {
  switch (issue.code) {
    case 'too_small':
      return { field, minimum: Number(issue.minimum) }

    case 'too_big':
      return { field, maximum: Number(issue.maximum) }

    case 'invalid_value':
      return { field, expected: issue.values.map(String).join(', ') }

    case 'unrecognized_keys':
      return { keys: issue.keys.join(', ') }

    default:
      return { field }
  }
}

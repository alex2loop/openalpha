import type { z } from 'zod'

import type { FieldIssue } from '@/core/field-errors'
import { FieldValidationError } from '@/core/field-errors'
import { toFieldLabel } from '@/trading/features/ledger/fields'

const ISSUE_KEY_PREFIX = 'errors.fields.'
const WHOLE_DRAFT = 'draft'

/** A refused draft, one field per zod issue, each with the sentence for it. The message the log
 *  keeps is English and names the same paths. */
export function toFieldValidationError(error: z.ZodError): FieldValidationError {
  const detail = error.issues
    .map((issue) => `${toPath(issue) || WHOLE_DRAFT}: ${issue.message}`)
    .join('; ')

  return new FieldValidationError(`invalid ledger draft: ${detail}`, error.issues.map(toFieldIssue))
}

function toFieldIssue(issue: z.core.$ZodIssue): FieldIssue {
  const path = toPath(issue)

  return {
    path,
    message: {
      key: `${ISSUE_KEY_PREFIX}${toIssueKind(issue)}`,
      params: toIssueParams(issue, path),
    },
  }
}

function toPath(issue: z.core.$ZodIssue): string {
  return issue.path.map(String).join('.')
}

/** Every code the draft schema raises has its own sentence; one it does not know reads as invalid. */
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

    default:
      return 'custom'
  }
}

function toIssueParams(
  issue: z.core.$ZodIssue,
  path: string
): NonNullable<FieldIssue['message']['params']> {
  const field = toFieldLabel(path)

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

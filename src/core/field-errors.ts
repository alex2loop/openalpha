import type { OperatorMessage } from '@/core/types/operator-message'
import { ValidationError } from '@/core/errors'

/** One refused field: where it sits in what the caller sent (`quantity`, `instrument.ticker`; empty
 *  for the whole body) and what to tell the operator about it. */
export interface FieldIssue {
  readonly path: string
  readonly message: OperatorMessage
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

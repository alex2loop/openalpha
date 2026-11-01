import type { OperatorMessage, ToolErrorCode } from '@/core/errors'
import { ToolError, ValidationError } from '@/core/errors'

/** A job input the operator can fix, worded for both readers: `message` is English, for the agent
 *  and the log; `operator` is the keyed sentence the CLI and the page print in the operator's
 *  language, found through the cause like any wrapper's (`operatorMessageOf`). */
export class JobInputError extends ToolError {
  constructor(code: ToolErrorCode, message: string, operator: OperatorMessage) {
    super(code, message, new ValidationError(message, operator))
  }
}

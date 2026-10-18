import { ToolError, ValidationError } from '@/core/errors'

/** A refusal the operator can act on and a tool failure pass through; anything else is wrapped as
 *  an unexpected failure. */
export function toPluginError(err: unknown, message: string): ToolError | ValidationError {
  return err instanceof ToolError || err instanceof ValidationError
    ? err
    : new ToolError('unexpected', message, err)
}

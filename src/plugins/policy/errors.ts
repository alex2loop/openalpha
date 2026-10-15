import { ToolError } from '@/core/errors'

export function toPluginError(err: unknown, message: string): ToolError {
  return err instanceof ToolError ? err : new ToolError('unexpected', message, err)
}

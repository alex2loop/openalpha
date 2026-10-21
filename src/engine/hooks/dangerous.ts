import type { CallApprovalContext, ToolDefinition } from '@/core/tool'
import { DANGEROUS_CAPABILITIES } from '@/engine/constants'

// Static danger comes from a side-effecting capability or code supplied outside this codebase.
function isDangerousTool(tool: ToolDefinition): boolean {
  return DANGEROUS_CAPABILITIES.has(tool.capability) || tool.isExternal === true
}

export function isDangerousCall(
  tool: ToolDefinition,
  input: unknown,
  context: () => CallApprovalContext
): boolean {
  return isDangerousTool(tool) || tool.requiresApproval?.(input, context()) === true
}

// A listing has no input to test, so a call-level `requiresApproval` counts as gated here.
export function canRequireApproval(tool: ToolDefinition): boolean {
  return isDangerousTool(tool) || tool.requiresApproval !== undefined
}

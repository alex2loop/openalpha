import type { ToolGate, ToolGateResult } from '@/engine/types/run'
import { ToolError } from '@/core/errors'

// The agent's tool allowlist is always fully resolved at profile-build time (an agent.toml that
// omits `[capabilities] tools` gets every registered tool name), so this is a plain membership test
// with no open-mode branch. During a delegated run `run.env.agent` is the selected child profile,
// so this check deliberately uses the child's resolved tools; a parent-missing tool still admits
// when the child lists it, and the approval gate then decides dangerous calls per-request.
export const capabilityGate: ToolGate = async (run, call): Promise<ToolGateResult> => {
  if (!run.env.agent.tools.includes(call.name)) {
    return blocked(`${call.name} not in agent capabilities`)
  }

  return { action: 'allow' }
}

function blocked(message: string): ToolGateResult {
  return { action: 'block', message, error: new ToolError('unauthorized', message) }
}

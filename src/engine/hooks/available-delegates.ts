// Wired in app/providers.ts, NOT engine/services.ts — this factory needs the fully-extended agents
// map.

import type { AgentProfile } from '@/engine/types/agent'
import type { LLMRequestModifier } from '@/engine/types/run'
import { truncate } from '@/core/utils/text'
import { appendSystemBlock } from '@/engine/hooks/system-block'

// Bound the block so a large roster cannot bloat the prompt.
const DELEGATES_BLOCK_MAX = 4_096
const DESC_MAX = 200

// Surfaces the caller's delegate roster and each role's description, so the model targets
// delegate(agent_id, prompt) precisely instead of guessing an id.
export function createAvailableDelegatesModifier(
  agents: ReadonlyMap<string, AgentProfile>
): LLMRequestModifier {
  return (run, req) => {
    const roster = run.env.agent.delegates

    if (roster.length === 0) {
      return req
    }

    const roles = roster
      .map((id) => agents.get(id))
      .filter((agent): agent is AgentProfile => agent !== undefined)
    const body = formatDelegateLines(roles)

    if (body === '') {
      return req
    }

    return appendSystemBlock(
      req,
      `<delegates>\nDelegate a sub-task with delegate(agent_id, prompt); agent_id must be one id below.\n${body.trimEnd()}\n</delegates>`
    )
  }
}

function formatDelegateLines(roles: readonly AgentProfile[]): string {
  let body = ''

  for (const role of roles) {
    const description =
      role.description === undefined ? '' : `: ${truncate(role.description, DESC_MAX)}`
    const line = `- ${role.id}${description}\n`

    // Always emit the first line, so one over-cap line cannot silently drop the whole block.
    if (body.length > 0 && body.length + line.length > DELEGATES_BLOCK_MAX) {
      break
    }

    body += line
  }

  return body
}

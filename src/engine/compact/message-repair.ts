import type { LLMMessage } from '@/core/llm'
import type { RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import { repairToolPairs, toolCallIdsOf } from '@/core/utils/message'

interface IntegrityReport {
  readonly valid: boolean
  readonly issues: readonly string[]
}

// Keep the first result for a call id; a duplicate is a provider or replay artifact.
function dedupByCallId(msgs: readonly LLMMessage[]): LLMMessage[] {
  const seen = new Set<string>()
  const kept: LLMMessage[] = []

  for (const msg of msgs) {
    const id = msg.role === 'tool' ? msg.toolCallId : undefined

    if (id !== undefined) {
      if (seen.has(id)) {
        continue
      }

      seen.add(id)
    }

    kept.push(msg)
  }

  return kept
}

export function validateMessageIntegrity(msgs: readonly LLMMessage[]): IntegrityReport {
  const issues: string[] = []
  const answered = new Set(
    msgs.flatMap((msg) =>
      msg.role === 'tool' && msg.toolCallId !== undefined ? [msg.toolCallId] : []
    )
  )
  const requested = new Set(msgs.flatMap((msg) => [...toolCallIdsOf(msg)]))

  for (const id of requested) {
    if (!answered.has(id)) {
      issues.push(`tool_call id=${id} has no matching tool result`)
    }
  }

  for (const id of answered) {
    if (!requested.has(id)) {
      issues.push(`tool result id=${id} has no matching tool_call`)
    }
  }

  return { valid: issues.length === 0, issues }
}

// Keep the most recent whole conversational groups within `cap`. The newest incomplete assistant
// group is retained while its tool results arrive; once complete it is trimmed atomically, and an
// oversized newest complete group remains intact. A leading system message is always preserved.
export function trimMessageGroups(
  messages: readonly LLMMessage[],
  cap: number
): readonly LLMMessage[] {
  const limit = Math.max(0, Math.floor(cap))

  if (messages.length <= limit) {
    return messages
  }

  const system = messages[0]?.role === 'system' ? messages[0] : undefined
  const body = system !== undefined ? messages.slice(1) : messages
  // The system message occupies one slot of the cap, so the body budget shrinks by one.
  const bodyLimit = system !== undefined ? Math.max(0, limit - 1) : limit
  const kept: LLMMessage[] = []

  // The newest group can be mid-execution: retain its assistant call until every result lands.
  // Older incomplete groups are stale and can be discarded without splitting a complete group.
  for (const [index, group] of [...groupMessages(body)].reverse().entries()) {
    const complete = isCompleteGroup(group)

    if (!complete && index > 0) {
      continue
    }

    if (kept.length > 0 && kept.length + group.length > bodyLimit) {
      break
    }

    kept.unshift(...group)
  }

  const tail = startAtUser(kept)

  return system !== undefined ? [system, ...tail] : tail
}

// Trimming can leave an assistant group first, and providers reject a history that does not open
// on a user turn. A user message always opens a group, so slicing there never splits one. With no
// user turn kept, the groups stay as they are: an empty history is worse than a leading assistant.
function startAtUser(kept: readonly LLMMessage[]): readonly LLMMessage[] {
  const firstUser = kept.findIndex((msg) => msg.role === 'user')

  return firstUser <= 0 ? kept : kept.slice(firstUser)
}

// A group is complete unless its leading assistant issued tool_calls that no tool
// result in the same group answers. Orphan tool results without a caller are left to
// applyRepairSequence/validateMessageIntegrity; this only guards the assistant side.
function isCompleteGroup(group: readonly LLMMessage[]): boolean {
  const leader = group[0]

  if (leader?.role !== 'assistant' || typeof leader.content === 'string') {
    return true
  }

  const callIds = leader.content
    .filter((block) => block.type === 'tool_call')
    .map((block) => block.call.id)

  if (callIds.length === 0) {
    return true
  }

  const resultIds = new Set<string>()

  for (const msg of group) {
    if (msg.role === 'tool' && msg.toolCallId !== undefined) {
      resultIds.add(msg.toolCallId)
    }
  }

  return callIds.every((id) => resultIds.has(id))
}

// Splits a message body into ordered groups: each user/assistant message opens a new group, and the
// tool messages that immediately follow an assistant attach to it. An orphan tool message (no
// preceding assistant) forms its own group.
export function groupMessages(msgs: readonly LLMMessage[]): readonly (readonly LLMMessage[])[] {
  const groups: LLMMessage[][] = []
  let current: LLMMessage[] | null = null

  for (const msg of msgs) {
    if (msg.role === 'user' || msg.role === 'assistant' || current === null) {
      current = []
      groups.push(current)
    }

    current.push(msg)
  }

  return groups
}

// Compaction order is an invariant: repairToolPairs -> dedupByCallId -> validateMessageIntegrity.
// Shared by the compactor and the stale-pruning hook so both enforce the same integrity contract.
export function applyRepairSequence(msgs: readonly LLMMessage[], run: RunView): LLMMessage[] {
  const repaired = dedupByCallId(repairToolPairs(msgs))
  const integrity = validateMessageIntegrity(repaired)

  if (!integrity.valid) {
    run.services.logger.error('compact.integrity_failed', { issues: integrity.issues })
    throw new RunHalted(
      'llm_error',
      `message integrity failed after repair: ${integrity.issues.join('; ')}`
    )
  }

  return repaired
}

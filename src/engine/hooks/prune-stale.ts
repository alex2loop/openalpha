import type { HookFn, RunView } from '@/engine/types/run'
import { RunHalted } from '@/core/errors'
import {
  applyRepairSequence,
  trimMessageGroups,
  validateMessageIntegrity,
} from '@/engine/compact/message-repair'

// Trims the prompt to the session message budget, but only across whole conversational groups so a
// tool_call never loses its result. Runs before each LLM call when the history is complete, so a
// surviving integrity failure is a real defect and halts the run rather than poisoning the model.
export const pruneStaleMessagesHook: HookFn = async (run: RunView) => {
  const cap = run.env.limits.sessionMessageCap
  const trimmed = trimMessageGroups(run.state.messages.history, cap)
  const repaired = applyRepairSequence(trimmed, run)

  if (!validateMessageIntegrity(repaired).valid) {
    throw new RunHalted('llm_error', 'message history failed integrity after pruning')
  }

  run.state.messages.replaceAll(repaired)
}

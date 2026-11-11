import type { MessageKey } from '@/i18n'

/** The key a child agent's unfinished outcome is told by; it ran out of room on a budget, turn,
 *  loop or time limit, was stopped, or failed. */
export const CHILD_PARTIAL_KEY: MessageKey = 'ui.office.agent.childPartial'
const CHILD_OUTCOME_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  budget: CHILD_PARTIAL_KEY,
  turn_limit: CHILD_PARTIAL_KEY,
  loop: CHILD_PARTIAL_KEY,
  timeout: CHILD_PARTIAL_KEY,
  aborted: 'ui.office.agent.childStopped',
  error: 'ui.office.agent.childFailed',
})

/** Why a child did not finish its work; absent for one that finished, or an outcome not listed. */
export function childOutcomeKey(outcome: string): MessageKey | undefined {
  return Object.hasOwn(CHILD_OUTCOME_KEYS, outcome) ? CHILD_OUTCOME_KEYS[outcome] : undefined
}

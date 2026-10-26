import type { MessageKey } from '@/i18n'

/** The key a child agent's unfinished outcome is told by; it ran out of room on a budget, turn,
 *  loop or time limit, was stopped, or failed. */
export const KID_PARTIAL_KEY: MessageKey = 'ui.office.agent.kidPartial'
const KID_OUTCOME_KEYS: Readonly<Record<string, MessageKey>> = Object.freeze({
  budget: KID_PARTIAL_KEY,
  turn_limit: KID_PARTIAL_KEY,
  loop: KID_PARTIAL_KEY,
  timeout: KID_PARTIAL_KEY,
  aborted: 'ui.office.agent.kidStopped',
  error: 'ui.office.agent.kidFailed',
})

/** Why a child did not finish its work; absent for one that finished, or an outcome not listed. */
export function kidOutcomeKey(outcome: string): MessageKey | undefined {
  return Object.hasOwn(KID_OUTCOME_KEYS, outcome) ? KID_OUTCOME_KEYS[outcome] : undefined
}

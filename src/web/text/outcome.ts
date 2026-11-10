import type { OutcomeVerdict } from '@/app/server/wire/vocab'

/** A scored result as the wire carries it: `verdict` is absent from an older daemon. */
export interface ScoredOutcome {
  readonly status: OutcomeVerdict
  readonly verdict?: OutcomeVerdict
}

/** What a scored call is named. An older daemon sends the `status` alone, which is the plain
 *  reading of the result, so it stands in when the `verdict` is absent. */
export function outcomeNameOf(outcome: ScoredOutcome): OutcomeVerdict {
  return outcome.verdict ?? outcome.status
}

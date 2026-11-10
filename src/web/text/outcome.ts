import type { OutcomeVerdict } from '@/app/server/wire/vocab'

/** What a scored call is named. An older daemon sends the `status` alone, which is the plain
 *  reading of the result, so it stands in when the `verdict` is absent. */
export function outcomeNameOf(outcome: {
  readonly status: OutcomeVerdict
  readonly verdict?: OutcomeVerdict
}): OutcomeVerdict {
  return outcome.verdict ?? outcome.status
}

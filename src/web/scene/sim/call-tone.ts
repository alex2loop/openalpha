import type { OutcomeVerdict } from '@/app/server/wire/vocab'
import { outcomeNameOf } from '@/web/text/outcome'

/** How a scored call lands at its maker's desk: a win (a target kept, or a raised stop that kept a
 *  gain) pleases, a miss (a stop, or a target given back) does not, and an expired call says
 *  nothing. It follows the result, not the status the call closed on. */
const CALL_TONES = Object.freeze({
  target: 'target',
  'stop-in-profit': 'target',
  'target-gave-back': 'stop',
  stop: 'stop',
} as const satisfies Partial<Record<OutcomeVerdict, 'target' | 'stop'>>)

export function callToneOf(call: {
  readonly status: OutcomeVerdict
  readonly verdict?: OutcomeVerdict
}): 'target' | 'stop' | undefined {
  const name = outcomeNameOf(call)

  return name === 'expired' ? undefined : CALL_TONES[name]
}

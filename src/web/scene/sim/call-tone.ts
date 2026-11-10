import type { WireEvent } from '@/app/server/wire/events'

type CallVerdict = NonNullable<WireEvent['call']>['verdict']

/** How a scored call lands at its maker's desk: a win (a target kept, or a raised stop that kept a
 *  gain) pleases, a miss (a stop, or a target given back) does not, and an expired call says
 *  nothing. It follows the result, not the status the call closed on. */
const CALL_TONES = Object.freeze({
  target: 'target',
  'stop-in-profit': 'target',
  'target-gave-back': 'stop',
  stop: 'stop',
} as const satisfies Partial<Record<CallVerdict, 'target' | 'stop'>>)

export function callToneOf(verdict: CallVerdict): 'target' | 'stop' | undefined {
  return verdict === 'expired' ? undefined : CALL_TONES[verdict]
}

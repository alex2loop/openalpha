import type { OutcomeStatus } from '@/trading/kernel/conviction'

/** What a scored call is named on every surface. The status says which level closed it; the
 *  return says what the whole trade earned, which a banked tranche or a raised stop can make
 *  differ from the status's plain reading. */
export const OUTCOME_VERDICTS = Object.freeze([
  'target',
  'target-gave-back',
  'stop',
  'stop-in-profit',
  'expired',
] as const)
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number]

/** One definition of a win, so the record and every measure built on it count alike. */
export function isWinningReturn(returnPct: number): boolean {
  return returnPct > 0
}

/** A target that netted nothing or less is a miss, and a stop that kept a gain is a win: the
 *  name follows the return, never the status alone. */
export function outcomeVerdictOf(outcome: {
  readonly status: OutcomeStatus
  readonly returnPct: number
}): OutcomeVerdict {
  const won = isWinningReturn(outcome.returnPct)

  if (outcome.status === 'target') {
    return won ? 'target' : 'target-gave-back'
  }

  if (outcome.status === 'stop') {
    return won ? 'stop-in-profit' : 'stop'
  }

  return 'expired'
}

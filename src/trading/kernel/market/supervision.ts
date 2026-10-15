import type { InstrumentRef } from '@/trading/kernel/instrument'

/** Ascending severity, so the more severe of two provider readings is the later one. `warning` and
 *  `control` describe the issuer while the tape still matches continuously; `restricted` and
 *  `suspended` mean it does not. */
export const SUPERVISION_LEVELS = Object.freeze([
  'warning',
  'control',
  'restricted',
  'suspended',
] as const)
export type SupervisionLevel = (typeof SUPERVISION_LEVELS)[number]

/** Emitted only for a name the exchange has placed under supervision. A name with no row is
 *  unsupervised; a read that failed carries a caveat instead of an empty set. */
export interface SupervisionRecord {
  readonly instrument: InstrumentRef
  readonly level: SupervisionLevel
}

/** One provider's whole-market read. `boards` states coverage instead of leaving it inferred: a
 *  board holding no supervised name and one nobody read are identical in `records` alone. Spelled
 *  as the provider spells it, like `SessionQuote.board`. */
export interface SupervisionSnapshot {
  readonly boards: readonly string[]
  /** Whether the exchange published this list itself. A redistributor's copy can drop a standing
   *  decision when it rebuilds its board, which reads as a clean name. */
  readonly authoritative: boolean
  readonly records: readonly SupervisionRecord[]
}

/** A name under two live decisions is published under both, and the severer is the one that
 *  describes the tape. */
export function severest(
  held: SupervisionLevel | undefined,
  read: SupervisionLevel
): SupervisionLevel {
  return held !== undefined && SUPERVISION_LEVELS.indexOf(held) > SUPERVISION_LEVELS.indexOf(read)
    ? held
    : read
}

// What one operator day added to the daemon, read after the fact. No model writes any of it.

/** One thing worth a look that day, in the daemon's words. `stop` is a stop that broke; `call` is a
 *  suggestion that closed with a large move. `at` is epoch ms. */
export interface NoteWire {
  readonly kind: 'stop' | 'call'
  readonly ticker: string
  readonly at: number
  readonly text: string
}

/** GET /v1/digest. */
export interface DigestWire {
  /** The operator's day, `YYYY-MM-DD`. */
  readonly day: string
  /** The calls an analyst made that day. */
  readonly suggestions: number
  /** The briefs stored for the day plus the deep-research runs that ended in it. */
  readonly reports: number
  /** What the day's model calls cost in USD, as `/v1/cost` counts a day. */
  readonly spendUsd: number
  /** At most two: a stop that broke first, then the call that closed with the largest move. */
  readonly notable: readonly NoteWire[]
}

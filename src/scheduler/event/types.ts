import type { JobId } from '@/core/ids'
import type { EventJobKind } from '@/core/types/event-job'

/** The largest instant `Date` and `Intl` accept. An event job is a `once` job parked here, so the
 *  tick never finds it due; nothing reads this as a time, and every reader branches on `Job.event`. */
export const EVENT_JOB_PARKED_AT = 8_640_000_000_000_000

/** What starts an event job. An absent `market` or `ticker` matches any name; a price job names the
 *  alert it was armed with instead of a price test of its own. */
export interface JobEvent {
  readonly event: EventJobKind
  readonly market?: string
  readonly ticker?: string
  readonly condition?: 'above' | 'below'
  readonly threshold?: number
  readonly alertId?: string
  readonly cooldownMs: number
}

/** An alert that fired, as the scheduler needs it. The instrument is local: the scheduler imports
 *  nothing of trading's vocabulary. */
export interface EventJobTrigger {
  readonly alertId: string
  readonly event: EventJobKind
  readonly instrument: { readonly market: string; readonly ticker: string }
  readonly condition?: 'above' | 'below'
  readonly threshold?: number
  readonly observedPrice: number
  readonly firedAt: number
}

export interface EventJobMatch {
  readonly event: EventJobKind
  readonly market: string
  readonly ticker: string
  readonly alertId: string
}

/** `firedAt` less `cooldownMs` is the latest earlier fire that still lets this one through. */
export interface EventFireClaim {
  readonly jobId: JobId
  readonly fireKey: string
  readonly firedAt: number
  readonly cooldownMs: number
}

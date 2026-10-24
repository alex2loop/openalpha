import type { JobId } from '@/core/ids'
import type { EventJobKind } from '@/core/types/event-job'
import { StorageError } from '@/core/errors'
import { EVENT_JOB_KINDS } from '@/core/types/event-job'

const CONDITIONS = ['above', 'below'] as const

/** What starts an event job. An absent `market` or `ticker` matches any; a price job names its
 *  alert instead. */
export interface StoredJobEvent {
  readonly event: EventJobKind
  readonly market?: string
  readonly ticker?: string
  readonly condition?: (typeof CONDITIONS)[number]
  readonly threshold?: number
  readonly alertId?: string
  readonly cooldownMs: number
}

/** The alert that fired, as the lookup needs it. */
export interface StoredEventMatch {
  readonly event: EventJobKind
  readonly market: string
  readonly ticker: string
  readonly alertId: string
}

export interface StoredEventFire {
  readonly jobId: JobId
  readonly fireKey: string
  readonly firedAt: number
  readonly cooldownMs: number
}

/** The trigger columns a job read selects beside the job's own, all null for a plain schedule. */
export interface EventRow {
  readonly trigger_event?: string | null
  readonly trigger_market?: string | null
  readonly trigger_ticker?: string | null
  readonly trigger_condition?: string | null
  readonly trigger_threshold?: number | null
  readonly trigger_alert_id?: string | null
  readonly trigger_cooldown_ms?: number | null
}

export function toJobEvent(row: EventRow): StoredJobEvent | undefined {
  const event = row.trigger_event ?? null

  if (event === null) {
    return undefined
  }

  const kind = EVENT_JOB_KINDS.find((candidate) => candidate === event)
  const condition = CONDITIONS.find((candidate) => candidate === row.trigger_condition)
  const cooldownMs = row.trigger_cooldown_ms ?? null

  if (kind === undefined || cooldownMs === null) {
    throw new StorageError('invalid persisted job event')
  }

  return {
    event: kind,
    ...(row.trigger_market == null ? {} : { market: row.trigger_market }),
    ...(row.trigger_ticker == null ? {} : { ticker: row.trigger_ticker }),
    ...(condition === undefined ? {} : { condition }),
    ...(row.trigger_threshold == null ? {} : { threshold: row.trigger_threshold }),
    ...(row.trigger_alert_id == null ? {} : { alertId: row.trigger_alert_id }),
    cooldownMs,
  }
}

/** In the order the trigger upsert binds: the key, then its columns. */
export function toTriggerParams(id: JobId, event: StoredJobEvent, now: number): readonly unknown[] {
  return [
    id,
    event.event,
    event.market ?? null,
    event.ticker ?? null,
    event.condition ?? null,
    event.threshold ?? null,
    event.alertId ?? null,
    event.cooldownMs,
    now,
  ]
}

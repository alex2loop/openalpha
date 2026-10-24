import type { TypedPrice } from '@/app/server/wire/vocab'
import type { EventJobKind } from '@/core/types/event-job'

/** The shortest cooldown the route accepts. The page offers half an hour, two hours and a day; a
 *  script may ask for any value from here up. */
export const MIN_EVENT_COOLDOWN_MS = 300_000

/** What starts an event job, as `/v1/state` shows it. A job with no `ticker` runs for any name. */
export interface JobEventWire {
  readonly event: EventJobKind
  /** The market `ticker` is in; absent for a job that names no market of its own. */
  readonly market?: string
  readonly ticker?: string
  readonly condition?: 'above' | 'below'
  readonly threshold?: number
  /** After a run, the job waits this long before it runs again for the same name. */
  readonly cooldownMs: number
}

/** A job that starts when an alert fires. `stop` and `target` follow the exit levels of the names
 *  the operator holds, `mover` follows the screener's sharp moves, and `price` is armed here: it
 *  needs `ticker`, `condition` and `threshold`, runs once, and is spent. */
export interface JobEventScheduleBody {
  readonly kind: 'event'
  readonly event: EventJobKind
  /** Narrows the job to one market; a bare ticker that two markets list needs it. */
  readonly market?: string
  readonly ticker?: string
  readonly condition?: 'above' | 'below'
  readonly threshold?: number
  /** `price` only: confirms a level far from the market, as `POST /v1/alerts` does. */
  readonly typedPrice?: TypedPrice
  readonly cooldownMs: number
}

type JobScheduleBody =
  | { readonly kind: 'cron'; readonly expr: string; readonly timezone?: string }
  | { readonly kind: 'interval'; readonly everyMs: number }
  /** `at` is epoch milliseconds, or a local "YYYY-MM-DD HH:mm" in the daemon's time zone. */
  | { readonly kind: 'once'; readonly at: number | string }
  | JobEventScheduleBody

/** POST /v1/jobs. The job has no owner, like one added from the CLI. */
export interface JobCreateBody {
  readonly agentId: string
  readonly prompt: string
  readonly schedule: JobScheduleBody
  readonly target?: { readonly channel: string; readonly chatId: string }
}

// The background tasks the daemon runs on its own, and when the next brief and intraday report are
// due. Wire-only: this folder imports nothing outside it.

import type { BriefScheduleWire } from '@/app/server/wire/system'

/** One background task. `name` is the daemon's own id and `label` the same task in the daemon's
 *  language (the name itself for a plugin's task). `everyMs` is the cadence where it has a fixed
 *  one; `lastRunAt` is when the last pass began, epoch ms; `lastError` is the credential-scrubbed
 *  message of the last pass if it failed, cleared by the next good one; `nextRunAt` is when the
 *  task's own timer fires next, epoch ms. */
export interface TaskStatusWire {
  readonly name: string
  readonly label: string
  readonly everyMs?: number
  readonly lastRunAt?: number
  readonly lastError?: string
  readonly nextRunAt?: number
  /** A pass is running now. */
  readonly working: boolean
}

/** The intraday report: `enabled` is the operator's switch, and `nextAt` the next fire in epoch ms,
 *  `null` while it is off or no time is configured. */
export interface IntradayNextWire {
  readonly enabled: boolean
  readonly nextAt: number | null
}

/** GET /v1/tasks. `brief` is absent when the brief was never enabled or trading is off; `intraday`
 *  is absent when trading is off. */
export interface TasksResponse {
  readonly tasks: readonly TaskStatusWire[]
  readonly brief?: BriefScheduleWire
  readonly intraday?: IntradayNextWire
}

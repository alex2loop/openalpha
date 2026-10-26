// The /v1 system routes: health, state, doctor, commands and cost. camelCase keys, no snake_case
// on the wire. A contract is replaced rather than deprecated; see CONTRACT.md §2.

import type { JobEventWire } from '@/app/server/wire/jobs'
import type { RestartWhen } from '@/app/server/wire/vocab'
import type { CheckName, DoctorStatus } from '@/core/types/doctor'
import type { Locale } from '@/core/types/locale'

/** How many of the latest runs a cost estimate reads: the command estimate below and the per-run
 *  price a model shows on `/v1/models`. */
export const COST_ESTIMATE_SAMPLE = 10

/** Sections whose backing store may not exist yet — the client greys the unbuilt tab instead of
 *  guessing from a 404. Only the sections that actually vary are listed (chat/approve/stream/health
 *  are always on). Echoed by GET /v1/health (unauth) and GET /v1/state. */
export interface Capabilities {
  readonly ohlcv: boolean
  readonly quotes: boolean
  readonly portfolio: boolean
  readonly suggestions: boolean
  /** A venue can place orders and `[api] orders` is on: the /v1/trade routes answer. */
  readonly orders: boolean
}

/** One thing the daemon started without, worded in its language: a channel left down with the
 *  reason (`subject` is the channel id), the API itself, or a key variable that is unset with what
 *  waits for it. An `optional-key` only trims a feature that has a keyless fallback. */
interface DegradedWire {
  readonly kind: 'channel' | 'api' | 'key' | 'optional-key'
  readonly subject: string
  readonly message: string
}

/** GET /v1/health — the only unauthenticated route. Liveness + version + capabilities. */
export interface HealthResponse {
  readonly ok: boolean
  /** 'starting' (with ok:false) while subsystems come up, 'ready' once live. The socket binds early
   *  so a booting daemon answers 'starting' instead of refusing — the client retries rather than
   *  showing "stopped". */
  readonly status?: 'starting' | 'ready'
  readonly version: string
  /** The product's display name, so a sign-in screen can name it before the token is entered. */
  readonly brand: string
  /** The `/v1/ws` contract this daemon speaks; a client built for another one cannot use it. */
  readonly contractVersion: number
  readonly capabilities: Capabilities
}

/** The morning brief's delivery. `sendTime` is HH:mm in the market's timezone and absent when the
 *  brief follows config. `nextDeliveryDay` (`YYYY-MM-DD`) and `nextDueAt` (epoch ms, when the
 *  brief is next due to send) are present while `scheduled`. */
export interface BriefScheduleWire {
  readonly state: 'scheduled' | 'delivering' | 'disabled'
  readonly channel: string
  readonly sendTime?: string
  readonly nextDeliveryDay?: string
  readonly nextDueAt?: number
}

interface HealthSection {
  readonly running: boolean
  readonly pid?: number
}

interface CostSection {
  /** Today's spend in USD (sum of session costs since local midnight). */
  readonly todayUsd: number
}

/** Scheduler rows pass through verbatim; the client reads `id` + whatever fields exist. The exact
 *  columns live in the scheduler store — deliberately open so the schedule shape can grow without a
 *  contract bump. Timestamp fields (e.g. `nextRunAt`) are epoch milliseconds. */
export interface ScheduleRow {
  readonly id: string | number
  /** When the job fires, as the scheduler stores it; the app words it ("Sun 20:00", "every 2 h"). */
  readonly schedule?:
    | { readonly kind: 'cron'; readonly expr: string; readonly timezone: string }
    | { readonly kind: 'interval'; readonly everyMs: number }
    | { readonly kind: 'once'; readonly at: number }
  /** Set on a job that runs when an alert fires. Such a job has no `schedule` and no `nextRunAt`. */
  readonly event?: JobEventWire
  readonly [field: string]: unknown
}

/** What the app still has to ask of someone on a first run. */
interface FirstRunWire {
  /** A model can answer: its key is set or its login is done, or the connected client answers. */
  readonly modelReady: boolean
  /** The operator saved a profile; a daemon that never did runs on seeded defaults. */
  readonly profileSaved: boolean
  /** The ledger holds no row at all. */
  readonly bookEmpty: boolean
}

/** GET /v1/state — the composite snapshot the panel polls. Optional sections are omitted until their
 *  store exists (see `capabilities`); the client renders "coming soon" for an absent section. */
export interface StatePayload {
  readonly version: string
  readonly health: HealthSection
  readonly cost: CostSection
  readonly schedules: readonly ScheduleRow[]
  readonly capabilities: Capabilities
  /** The IANA zone the daemon's days are counted in: cost caps, `/v1/cost` days, suggestion days. */
  readonly timeZone: string
  /** The daemon's `[locale] language`: the language its own text is written in. */
  readonly locale: Locale
  /** What the daemon started without; empty when everything is configured. Behind auth, since it
   *  names unset variables and channels that are down. */
  readonly degraded: readonly DegradedWire[]
  /** Absent when the brief was never enabled or trading is off. */
  readonly brief?: BriefScheduleWire
  /** The daemon runs in the background, so `POST /v1/restart` can restart it. False in a terminal
   *  or under a service. */
  readonly restartable: boolean
  /** The longest a restart with `when: 'idle'` waits for the daemon to go quiet. */
  readonly restartIdleWaitMs: number
  /** The grace runs in flight get when the daemon stops, before they are cut. Not the downtime of a
   *  restart: watch `/v1/health` go down, then up with a new `pid`. */
  readonly restartDrainMs: number
  /** Resolved calls a track record needs before its rates mean anything. */
  readonly trackRecordMinSample: number
  /** The longest one child agent an agent spawned may run. */
  readonly childRunMaxMs: number
  readonly firstRun: FirstRunWire
  /** The longest the daemon lets its slow routes run, so a client waits for them that long. */
  readonly slowRequestMs: number
  /** `[api] public_url` is set: keys and the ChatGPT sign-in change only on the server. */
  readonly exposed: boolean
}

/** POST /v1/restart. */
export interface RestartBody {
  readonly when: RestartWhen
}

/** 202 from POST /v1/restart. The shutdown refuses every approval still waiting, so the app can
 *  warn before it restarts. */
export interface RestartAcceptedWire {
  readonly refusedApprovals: number
}

interface CostRow {
  /** The agent whose daily cap the spend counted against; `agentId` ran it. */
  readonly billingAgentId: string
  readonly agentId: string
  readonly provider: string
  readonly model: string
  readonly calls: number
  readonly failedCalls: number
  readonly costUsd: number
  readonly inputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWriteTokens: number
  readonly outputTokens: number
  readonly reasoningTokens: number
  readonly averageLatencyMs?: number
}

interface CostJobWire {
  readonly kind: 'command' | 'agent'
  /** The command name, or the agent id. */
  readonly name: string
  /** How many top-level runs of this job billed in the range. */
  readonly runs: number
  readonly costUsd: number
}

/** GET /v1/update — whether a newer daemon release is out. `enabled` false: checks are off (config,
 *  or a source checkout that updates with git), and `latest` is null. The feed is read once a day. */
export interface UpdateResponse {
  readonly enabled: boolean
  readonly current: string
  /** The newest release, newer or not: the app compares it with its own version and `current`. */
  readonly latest: string | null
  /** The release page of `latest`. */
  readonly url: string | null
  /** When the feed last answered or failed; 0 before the first check. */
  readonly checkedAt: number
  /** `latest` is newer than `current`. */
  readonly newer: boolean
  /** The releases newer than `current` up to `latest`, newest first; empty while their notes are
   *  unread. `summary` is in the daemon's language, absent when the release has none in it. */
  readonly notes: readonly UpdateNoteWire[]
  /** What to run on the daemon's machine to upgrade. */
  readonly upgradeCommand: string
}

interface UpdateNoteWire {
  readonly version: string
  readonly important: boolean
  readonly summary?: string
}

/** GET /v1/cost?from&to — AI spend over an inclusive range of `YYYY-MM-DD` days, at most 366.
 *  One row per agent and model. `caps` are the configured daily and monthly limits in USD; 0 means
 *  no limit. */
export interface CostReport {
  readonly fromDay: string
  readonly toDay: string
  readonly totalUsd: number
  readonly caps: {
    readonly dailyUsd: number
    readonly monthlyUsd: number
    /** The share of a cap at which the daemon warns (0 to 1). */
    readonly warnRatio: number
  }
  /** One total per calendar day, oldest first, zero days included. */
  readonly days: readonly { readonly day: string; readonly costUsd: number }[]
  readonly rows: readonly CostRow[]
  /** The same calls by the top-level run each belongs to (child runs included), one row per job,
   *  costliest first. */
  readonly jobs: readonly CostJobWire[]
  /** The calls whose top-level run has no run row (none written, still running, or pruned), so
   *  the jobs and this add up to `totalUsd`. */
  readonly otherUsd: number
}

/** The check a doctor row belongs to: the CLI's `doctor <check>` name, or `api` for the API token. */
export type DoctorCheckId = CheckName | 'api'

/** GET /v1/doctor — one row of a check, worded as the CLI's `doctor` words it. */
export interface DoctorCheck {
  readonly check: DoctorCheckId
  /** The row label, in the daemon's language. */
  readonly name: string
  /** `cliOnly`: a check only `doctor` in a terminal on the server can run; it has no status. */
  readonly status: DoctorStatus | 'cliOnly'
  /** `status` is `ok` or `info`. */
  readonly ok: boolean
  /** Short human line; never a stack trace. */
  readonly detail?: string
}

/** `?online=1` adds the network probes except any model call; `?check=<id>` runs one check. */
export interface DoctorReport {
  readonly checks: readonly DoctorCheck[]
  /** When the daemon ran these checks. */
  readonly checkedAt: number
  readonly online: boolean
}

/** GET /v1/commands — one slash command for chat completion. The same registry the CLI and channels
 *  use, filtered to the channel surface. */
interface SlashCommandInfo {
  /** Includes the leading slash: '/new', '/agent'… */
  readonly name: string
  /** The command's description, already in the daemon's language. */
  readonly summary: string
  /** Sub-command names for the completion ghost (e.g. schedule: ['add','list','remove']). */
  readonly args?: readonly string[]
  /** What a run usually costs: the 25th to 75th percentile of the last runs that cost something.
   *  Absent until enough runs exist. `0` to `0` means it has not cost AI so far. */
  readonly estimate?: { readonly lowUsd: number; readonly highUsd: number; readonly runs: number }
}

export interface CommandList {
  readonly commands: readonly SlashCommandInfo[]
}

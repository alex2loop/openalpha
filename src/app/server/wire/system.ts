// The /v1 system routes: health, state, doctor, commands and cost. camelCase keys, no snake_case
// on the wire. A contract is replaced rather than deprecated; see CONTRACT.md §2.

/** Sections whose backing store may not exist yet — the client greys the unbuilt tab instead of
 *  guessing from a 404. Only the sections that actually vary are listed (chat/approve/stream/health
 *  are always on). Echoed by GET /v1/health (unauth) and GET /v1/state. */
export interface Capabilities {
  readonly ohlcv: boolean
  readonly quotes: boolean
  readonly portfolio: boolean
  readonly suggestions: boolean
  /** A venue can place orders: the /v1/trade routes answer. */
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
  /** The `/v1/ws` contract this daemon speaks; a client built for another one cannot use it. */
  readonly contractVersion: number
  readonly capabilities: Capabilities
}

/** The morning brief's delivery. `sendTime` is HH:mm in the market's timezone and absent when the
 *  brief follows config. `nextDeliveryDay` (`YYYY-MM-DD`) is present while `scheduled`. */
export interface BriefScheduleWire {
  readonly state: 'scheduled' | 'delivering' | 'disabled'
  readonly channel: string
  readonly sendTime?: string
  readonly nextDeliveryDay?: string
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
interface ScheduleRow {
  readonly id: string | number
  /** When the job fires, as the scheduler stores it; the app words it ("Sun 20:00", "every 2 h"). */
  readonly schedule?:
    | { readonly kind: 'cron'; readonly expr: string; readonly timezone: string }
    | { readonly kind: 'interval'; readonly everyMs: number }
    | { readonly kind: 'once'; readonly at: number }
  readonly [field: string]: unknown
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
  /** What the daemon started without; empty when everything is configured. Behind auth, since it
   *  names unset variables and channels that are down. */
  readonly degraded: readonly DegradedWire[]
  /** Absent when the brief was never enabled or trading is off. */
  readonly brief?: BriefScheduleWire
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
}

/** GET /v1/doctor — one diagnostic row (config / storage / provider auth) for the More tab. */
export interface DoctorCheck {
  /** e.g. 'config', 'database', 'provider: openrouter'. */
  readonly name: string
  readonly ok: boolean
  /** Short human line; never a stack trace. */
  readonly detail?: string
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheck[]
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
}

export interface CommandList {
  readonly commands: readonly SlashCommandInfo[]
}

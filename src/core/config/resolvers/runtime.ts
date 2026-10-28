import type { ChannelAddress } from '@/core/channels'
import type {
  RawApi,
  RawBudget,
  RawConfig,
  RawLlm,
  RawLoop,
  RawNotices,
  RawSchedule,
} from '@/core/config/schema'
import type { Locale } from '@/core/types/locale'
import { parseChannelAddress } from '@/core/channels'
import { OperatorConfigError } from '@/core/config/operator-errors'
import { ConfigError } from '@/core/errors'
import { DEFAULT_MAX_DURATION_MS, DEFAULT_MAX_TOOL_CALLS, DEFAULT_MAX_TURNS } from '@/core/limits'

// Caps are opt-in guardrails: 0 = uncapped, only tracked.
const DEFAULT_MAX_DAILY_USD = 0
const DEFAULT_MAX_MONTHLY_USD = 0
const DEFAULT_MAX_PER_RUN_USD = 0
const DEFAULT_SOFT_WARN_RATIO = 0.8
const DEFAULT_LANGUAGE = 'vi'
const FALLBACK_TIMEZONE = 'UTC'
const HTTPS_PROTOCOL = 'https:'
const DEFAULT_TICK_SECONDS = 30
const DEFAULT_MAX_PER_TICK = 5
const DEFAULT_MAX_GLOBAL = 50
const DEFAULT_SCHEDULER_APPROVAL_TIMEOUT_MS = 900_000
const DEFAULT_COMPACTION_THRESHOLD = 0.75
const DEFAULT_MAX_COMPACTION_PASSES = 3
const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000
const DEFAULT_SESSION_MESSAGE_CAP = 500
const DEFAULT_MAX_CALLS_PER_MINUTE = 60
const DEFAULT_LLM_MAX_RETRIES = 2
const DEFAULT_LLM_RETRY_BACKOFF_MS = 500
const DEFAULT_LLM_TRANSIENT_COOLDOWN_MS = 60_000
const DEFAULT_LLM_CREDENTIAL_COOLDOWN_MS = 900_000
const DEFAULT_DELEGATION_DEPTH = 3
const DEFAULT_MAX_DELEGATIONS = 32
const DEFAULT_MAX_PARALLEL_DELEGATIONS = 5
const DEFAULT_MAX_SPAWN_DURATION_MS = 600_000
const DEFAULT_MAX_SPAWN_TURNS = 12
const DEFAULT_MAX_UNASKED_FETCHES = 10
const DEFAULT_API_PORT = 8765

export interface ResolvedBudget {
  readonly maxDailyUsd: number
  readonly maxMonthlyUsd: number
  readonly softWarnRatio: number
  readonly maxPerRunUsd: number
}

export interface ResolvedLocale {
  readonly language: Locale
  readonly timezone: string
  readonly currency?: string
  readonly region?: string
}

export interface ResolvedSchedule {
  readonly tickSeconds: number
  readonly maxPerTick: number
  readonly maxGlobal: number
  readonly approvalTimeoutMs: number
  readonly failureTarget?: ChannelAddress
}

export interface ResolvedLoop {
  readonly maxTurns: number
  readonly maxToolCalls: number
  readonly maxDurationMs: number
  readonly compactionThreshold: number
  readonly maxCompactionPasses: number
  readonly approvalTimeoutMs: number
  readonly sessionMessageCap: number
  readonly delegationDepth: number
  readonly maxDelegations: number
  readonly maxParallelDelegations: number
  readonly maxSpawnDurationMs: number
  readonly maxSpawnTurns: number
  readonly maxUnaskedFetches: number
}

export interface ResolvedLlm {
  readonly maxCallsPerMinute: number
  readonly maxRetries: number
  readonly retryBackoffMs: number
  readonly transientCooldownMs: number
  readonly credentialCooldownMs: number
}

export interface ResolvedApi {
  readonly enabled: boolean
  readonly port: number
  readonly tokenEnv?: string
  /** Order routes and the order tool over the API; off by default once `publicUrl` is set. */
  readonly orders: boolean
  /** The origin the daemon is reached at through a proxy: `https://host[:port]`, no path. */
  readonly publicUrl?: string
}

export interface ResolvedNotices {
  /** Notice kinds sent to a chat as well as the bell; `app` owns the kind names and checks them. */
  readonly chat: readonly string[]
}

type MutableSchedule = { -readonly [K in keyof ResolvedSchedule]: ResolvedSchedule[K] }

export function resolveBudget(raw: RawBudget | undefined): ResolvedBudget {
  return {
    maxDailyUsd: raw?.max_daily_usd ?? DEFAULT_MAX_DAILY_USD,
    maxMonthlyUsd: raw?.max_monthly_usd ?? DEFAULT_MAX_MONTHLY_USD,
    softWarnRatio: raw?.soft_warn_ratio ?? DEFAULT_SOFT_WARN_RATIO,
    maxPerRunUsd: raw?.max_per_run_usd ?? DEFAULT_MAX_PER_RUN_USD,
  }
}

export function resolveLocale(raw: RawConfig['locale']): ResolvedLocale {
  const language = raw?.language ?? DEFAULT_LANGUAGE

  if (language !== 'en' && language !== 'vi') {
    throw new OperatorConfigError(
      `invalid locale.language: "${language}" — must be "en" or "vi"`,
      { key: 'errors.configLanguage', params: { language } },
      { path: ['locale', 'language'] }
    )
  }

  const timezone = raw?.timezone ?? hostTimeZone()

  if (!isTimeZone(timezone)) {
    throw new OperatorConfigError(
      `invalid locale.timezone: "${timezone}" is not a valid IANA timezone`,
      { key: 'errors.configTimezone', params: { timezone } },
      { path: ['locale', 'timezone'] }
    )
  }

  return {
    language,
    timezone,
    ...(raw?.currency === undefined ? {} : { currency: raw.currency }),
    ...(raw?.region === undefined ? {} : { region: raw.region }),
  }
}

export function resolveSchedule(raw: RawSchedule | undefined): ResolvedSchedule {
  const schedule: MutableSchedule = {
    tickSeconds: DEFAULT_TICK_SECONDS,
    maxPerTick: DEFAULT_MAX_PER_TICK,
    maxGlobal: DEFAULT_MAX_GLOBAL,
    approvalTimeoutMs: raw?.approval_timeout_ms ?? DEFAULT_SCHEDULER_APPROVAL_TIMEOUT_MS,
  }

  if (raw?.failure_target !== undefined) {
    try {
      schedule.failureTarget = parseChannelAddress(raw.failure_target)
    } catch (err: unknown) {
      if (err instanceof ConfigError) {
        throw new OperatorConfigError(
          err.message,
          {
            key: 'errors.configFailureTarget',
            params: { target: raw.failure_target },
          },
          { path: ['schedule', 'failure_target'] }
        )
      }
      throw err
    }
  }

  return schedule
}

export function resolveLoop(raw: RawLoop | undefined): ResolvedLoop {
  return {
    maxTurns: raw?.max_turns ?? DEFAULT_MAX_TURNS,
    maxToolCalls: raw?.max_tool_calls ?? DEFAULT_MAX_TOOL_CALLS,
    maxDurationMs: raw?.max_duration_ms ?? DEFAULT_MAX_DURATION_MS,
    compactionThreshold: DEFAULT_COMPACTION_THRESHOLD,
    maxCompactionPasses: DEFAULT_MAX_COMPACTION_PASSES,
    approvalTimeoutMs: raw?.approval_timeout_ms ?? DEFAULT_APPROVAL_TIMEOUT_MS,
    sessionMessageCap: DEFAULT_SESSION_MESSAGE_CAP,
    delegationDepth: raw?.delegation_depth ?? DEFAULT_DELEGATION_DEPTH,
    maxDelegations: raw?.max_delegations ?? DEFAULT_MAX_DELEGATIONS,
    maxParallelDelegations: raw?.max_parallel_delegations ?? DEFAULT_MAX_PARALLEL_DELEGATIONS,
    maxSpawnDurationMs: raw?.max_spawn_duration_ms ?? DEFAULT_MAX_SPAWN_DURATION_MS,
    maxSpawnTurns: raw?.max_spawn_turns ?? DEFAULT_MAX_SPAWN_TURNS,
    maxUnaskedFetches: raw?.max_unasked_fetches ?? DEFAULT_MAX_UNASKED_FETCHES,
  }
}

export function resolveLlm(raw: RawLlm | undefined): ResolvedLlm {
  return {
    maxCallsPerMinute: raw?.max_calls_per_minute ?? DEFAULT_MAX_CALLS_PER_MINUTE,
    maxRetries: DEFAULT_LLM_MAX_RETRIES,
    retryBackoffMs: DEFAULT_LLM_RETRY_BACKOFF_MS,
    transientCooldownMs: DEFAULT_LLM_TRANSIENT_COOLDOWN_MS,
    credentialCooldownMs: DEFAULT_LLM_CREDENTIAL_COOLDOWN_MS,
  }
}

export function resolveApi(raw: RawApi | undefined): ResolvedApi {
  const publicUrl = raw?.public_url === undefined ? undefined : resolvePublicUrl(raw.public_url)
  const isLocalOnly = publicUrl === undefined

  return {
    enabled: raw?.enabled ?? true,
    port: raw?.port ?? DEFAULT_API_PORT,
    ...(raw?.token_env === undefined ? {} : { tokenEnv: raw.token_env }),
    orders: raw?.orders ?? isLocalOnly,
    ...(publicUrl === undefined ? {} : { publicUrl }),
  }
}

function resolvePublicUrl(raw: string): string {
  const origin = toPublicOrigin(raw)

  if (origin === undefined) {
    // The value is never echoed: it may carry a user name, password or query secret.
    throw new OperatorConfigError(
      'invalid api.public_url',
      { key: 'errors.configApiPublicUrl' },
      { path: ['api', 'public_url'] }
    )
  }

  return origin
}

// A spelling the browser would send back differently (path, query, userinfo, http) cannot be the
// page's origin, so it is refused rather than trimmed. `href` keeps an empty `?` or `#` that
// `search` and `hash` drop, so it is compared whole.
function toPublicOrigin(raw: string): string | undefined {
  if (!URL.canParse(raw)) {
    return undefined
  }

  const url = new URL(raw)
  const isOriginOnly = url.protocol === HTTPS_PROTOCOL && url.href === `${url.origin}/`

  return isOriginOnly ? url.origin : undefined
}

export function resolveNotices(raw: RawNotices | undefined): ResolvedNotices {
  return { chat: raw?.chat ?? [] }
}

// Cron, one-shot jobs, and the prompt's date block all read this one value, and every time the
// operator names is wall clock on their own machine. A host with no zone set reports UTC.
function hostTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIMEZONE
}

function isTimeZone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

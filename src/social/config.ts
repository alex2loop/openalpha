import { z } from 'zod'

import type { DailyWindow } from '@/core/utils/time'
import { OperatorConfigError, toInvalidConfigError } from '@/core/config/resolve'
import { formatErrForLog } from '@/core/security/credentials'
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, parseDailyWindow } from '@/core/utils/time'
import { refusedToolNames } from '@/social/tool-rules'

/** This module is the section's only claimant, so it owns the name. */
export const SOCIAL_CONFIG_SECTION = 'social'

const DEFAULT_POSTS_PER_DAY = 8
const DEFAULT_COMMENTS_PER_DAY = 40
const DEFAULT_VISIT_INTERVAL_MS = 2 * MS_PER_HOUR
/** Votes and follows say little in public, so their caps are fixed rules, not settings. */
const VOTES_PER_DAY = 100
const FOLLOWS_PER_DAY = 20
/** One visit: enough turns to read, answer a challenge and write once or twice. */
const VISIT_MAX_TURNS = 8
const VISIT_MAX_DURATION_MS = 5 * MS_PER_MINUTE
/** The same notice from one visit is sent at most once a day. */
const VISIT_DUPLICATE_WINDOW_MS = MS_PER_DAY
/** The shortest gap between two visits, here and for `social join --every`. */
export const MIN_VISIT_INTERVAL_MS = MS_PER_MINUTE

const CAPPED_LABELS = ['post', 'comment', 'vote', 'follow'] as const

const count = z.int().positive()

/** Only what an operator has a reason to change: which extra tools, how often, at what hours, and
 *  how much is published under their name. Every other bound is a fixed rule in the file that
 *  enforces it. */
const SOCIAL_SCHEMA = z.strictObject({
  allowed_tools: z.array(z.string().min(1)).optional(),
  heartbeat_interval_ms: z.int().min(MIN_VISIT_INTERVAL_MS).optional(),
  active_hours: z.string().optional(),
  max_posts_per_day: count.optional(),
  max_comments_per_day: count.optional(),
})

type SocialPatch = z.infer<typeof SOCIAL_SCHEMA>

/** The public writes a network counts per day. */
export type CappedLabel = (typeof CAPPED_LABELS)[number]

export interface SocialHeartbeatConfig {
  readonly intervalMs: number
  readonly maxTurns: number
  readonly maxDurationMs: number
  readonly duplicateWindowMs: number
  /** Absent: a visit may start at any hour. */
  readonly activeHours?: DailyWindow
}

export interface SocialConfig {
  readonly allowedTools: readonly string[]
  readonly dailyCaps: Readonly<Record<CappedLabel, number>>
  readonly heartbeat: SocialHeartbeatConfig
}

interface ResolveSocialConfigOptions {
  readonly extensions: Readonly<Record<string, unknown>>
  /** `[loop] max_duration_ms`: a visit never outlasts a run; it also sizes the lease. */
  readonly loopMaxDurationMs: number
  /** `[locale] timezone`, the clock `active_hours` is read on. */
  readonly timeZone: string
}

/** Applies the section over the defaults once, so no call site restates one. */
export function isCappedLabel(label: string): label is CappedLabel {
  return CAPPED_LABELS.some((capped) => capped === label)
}

export function resolveSocialConfig(options: ResolveSocialConfigOptions): SocialConfig {
  const patch = parseSocialPatch(options.extensions[SOCIAL_CONFIG_SECTION])
  const refused = refusedToolNames(patch.allowed_tools ?? [])

  if (refused.length > 0) {
    throw new OperatorConfigError(
      `[social] allowed_tools may not include ${refused.join(', ')}`,
      { key: 'errors.configSocialToolsRefused', params: { tools: refused.join(', ') } },
      { path: [SOCIAL_CONFIG_SECTION, 'allowed_tools'] }
    )
  }

  const activeHours = resolveActiveHours(patch.active_hours, options.timeZone)

  return Object.freeze({
    allowedTools: Object.freeze([...(patch.allowed_tools ?? [])]),
    dailyCaps: Object.freeze({
      post: patch.max_posts_per_day ?? DEFAULT_POSTS_PER_DAY,
      comment: patch.max_comments_per_day ?? DEFAULT_COMMENTS_PER_DAY,
      vote: VOTES_PER_DAY,
      follow: FOLLOWS_PER_DAY,
    }),
    heartbeat: Object.freeze({
      intervalMs: patch.heartbeat_interval_ms ?? DEFAULT_VISIT_INTERVAL_MS,
      maxTurns: VISIT_MAX_TURNS,
      maxDurationMs: Math.min(VISIT_MAX_DURATION_MS, options.loopMaxDurationMs),
      duplicateWindowMs: VISIT_DUPLICATE_WINDOW_MS,
      ...(activeHours === undefined ? {} : { activeHours }),
    }),
  })
}

function parseSocialPatch(raw: unknown): SocialPatch {
  const parsed = SOCIAL_SCHEMA.safeParse(raw ?? {})

  if (parsed.success) {
    return parsed.data
  }

  throw toInvalidConfigError(parsed.error, SOCIAL_SCHEMA, { section: SOCIAL_CONFIG_SECTION })
}

function resolveActiveHours(raw: string | undefined, timeZone: string): DailyWindow | undefined {
  if (raw === undefined || raw.trim() === '') {
    return undefined
  }

  try {
    return parseDailyWindow(raw, timeZone)
  } catch (err: unknown) {
    throw new OperatorConfigError(
      `invalid [social] active_hours: ${formatErrForLog(err).message}`,
      { key: 'errors.configSocialActiveHours', params: { value: raw } },
      { path: [SOCIAL_CONFIG_SECTION, 'active_hours'] }
    )
  }
}

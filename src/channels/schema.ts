import { readFileSync } from 'node:fs'

import { z } from 'zod'

import type { ChannelId } from '@/core/channels'
import { toInvalidConfigError } from '@/core/config/resolve'
import { MS_PER_MINUTE } from '@/core/utils/time'

const CHANNELS_CONFIG_SECTION = 'channels'
const DEFAULT_DEBOUNCE_MS = 600
const DEFAULT_NEAR_SPLIT_DEBOUNCE_MS = 2_000
const DEFAULT_MID_STREAM_THROTTLE_MS = 1_500
const DEFAULT_NOTIFY_MAX_PER_MINUTE = 3
const DEFAULT_GAP_NOTE_MS = 30 * MS_PER_MINUTE
const DEFAULT_NOTIFY_QUEUE_MAX = 50
const DEFAULT_NOTIFY_MAX_ATTEMPTS = 3
// How long shutdown waits for the queue to drain before it settles the rest as dropped.
const DEFAULT_NOTIFY_DRAIN_TIMEOUT_MS = 500

export const SAFE_DELIVERY_OVERRIDE_FIELDS = [
  'markdown',
  'mid_stream_updates',
  'typing_indicator',
  'use_reactions',
  'notify_max_per_minute',
] as const

// No open mode: every admitted chat acts as the single local operator, so an unrestricted
// channel would expose that operator's ledger, profile, and memory to any sender.
const DM_POLICIES = ['pairing', 'allowlist', 'disabled'] as const

export const allowlistField = z.array(z.union([z.string(), z.number()])).optional()

export const dmPolicyField = z.enum(DM_POLICIES).optional()

export const secretFields = {
  token_env: z.string().min(1).optional(),
  token_file: z.string().min(1).optional(),
}

export const deliveryFields = {
  enabled: z.boolean().optional(),
  agent: z.string().min(1).optional(),
  markdown: z.boolean().optional(),
  mid_stream_updates: z.boolean().optional(),
  require_mention: z.boolean().optional(),
  slash_commands: z.boolean().optional(),
  typing_indicator: z.boolean().optional(),
  use_reactions: z.boolean().optional(),
  notify_max_per_minute: z.number().int().positive().optional(),
  gap_note_ms: z.number().int().nonnegative().optional(),
  fallback_chat_id: z.string().min(1).optional(),
}

const deliverySchema = z.strictObject(deliveryFields)

export type ChannelDeliveryConfig = z.infer<typeof deliverySchema>

export interface ChannelSettings {
  readonly agent?: string
  readonly markdown: boolean
  readonly midStreamUpdates: boolean
  readonly requireMention: boolean
  readonly slashCommands: boolean
  readonly typingIndicator: boolean
  readonly useReactions: boolean
  readonly debounceMs: number
  readonly nearSplitDebounceMs: number
  readonly midStreamThrottleMs: number
  readonly notifyMaxPerMinute: number
  readonly notifyQueueMax: number
  readonly notifyMaxAttempts: number
  readonly notifyDrainTimeoutMs: number
  /** Quiet time after which a run is told its prices are stale; 0 turns it off. */
  readonly gapNoteMs: number
  readonly fallbackChatId?: string
}

type MutableSettings = { -readonly [K in keyof ChannelSettings]: ChannelSettings[K] }

interface AdmissionIdConfig {
  readonly allowed_ids?: readonly (string | number)[] | undefined
  readonly operator_user_ids?: readonly (string | number)[] | undefined
}

interface AdmissionIds {
  readonly allowedIds: readonly string[]
  readonly operatorUserIds: readonly string[]
}

/** A wrong value refuses the way any other section does, naming `channels.<id>.<key>`. */
export function parseChannelSection<T extends z.ZodType>(
  schema: T,
  raw: unknown,
  channel: ChannelId
): z.output<T> {
  const parsed = schema.safeParse(raw ?? {})

  if (parsed.success) {
    return parsed.data
  }

  throw toInvalidConfigError(parsed.error, schema, {
    section: `${CHANNELS_CONFIG_SECTION}.${channel}`,
  })
}

export function resolveChannelSettings(cfg: ChannelDeliveryConfig): ChannelSettings {
  // exactOptionalPropertyTypes rejects an explicit `undefined` for `foo?: T`.
  const out: MutableSettings = {
    markdown: cfg.markdown ?? true,
    midStreamUpdates: cfg.mid_stream_updates ?? true,
    requireMention: cfg.require_mention ?? true,
    slashCommands: cfg.slash_commands ?? true,
    typingIndicator: cfg.typing_indicator ?? true,
    useReactions: cfg.use_reactions ?? true,
    debounceMs: DEFAULT_DEBOUNCE_MS,
    nearSplitDebounceMs: DEFAULT_NEAR_SPLIT_DEBOUNCE_MS,
    midStreamThrottleMs: DEFAULT_MID_STREAM_THROTTLE_MS,
    notifyMaxPerMinute: cfg.notify_max_per_minute ?? DEFAULT_NOTIFY_MAX_PER_MINUTE,
    notifyQueueMax: DEFAULT_NOTIFY_QUEUE_MAX,
    notifyMaxAttempts: DEFAULT_NOTIFY_MAX_ATTEMPTS,
    notifyDrainTimeoutMs: DEFAULT_NOTIFY_DRAIN_TIMEOUT_MS,
    gapNoteMs: cfg.gap_note_ms ?? DEFAULT_GAP_NOTE_MS,
  }

  if (cfg.agent !== undefined) {
    out.agent = cfg.agent
  }

  if (cfg.fallback_chat_id !== undefined) {
    out.fallbackChatId = cfg.fallback_chat_id
  }

  return out
}

export function resolveAdmissionIds(config: AdmissionIdConfig): AdmissionIds {
  return {
    allowedIds: normalizeIds(config.allowed_ids),
    operatorUserIds: normalizeIds(config.operator_user_ids),
  }
}

// Ids are numeric in Telegram and string-ish elsewhere; the pipeline compares them as strings.
function normalizeIds(raw: readonly (string | number)[] | undefined): readonly string[] {
  return (raw ?? []).map((id) => String(id).trim()).filter((id) => id.length > 0)
}

// zod's `.optional()` infers `T | undefined`, which a bare `field?: T` rejects.
export function resolveSecret(
  cfg: {
    readonly token_env?: string | undefined
    readonly token_file?: string | undefined
  },
  env: Record<string, string | undefined>
): string {
  if (cfg.token_env) {
    return env[cfg.token_env]?.trim() ?? ''
  }

  if (cfg.token_file) {
    return readSecretFile(cfg.token_file)
  }

  return ''
}

function readSecretFile(path: string): string {
  try {
    // Boot-time only: channels are constructed during startup, never per message.
    return readFileSync(path, 'utf8').trim()
  } catch {
    // Unreadable secret file is indistinguishable from an unset one here; `doctor` diagnoses it.
    return ''
  }
}

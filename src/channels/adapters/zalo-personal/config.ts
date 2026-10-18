// zalo-personal drives an UNOFFICIAL personal-account API, not Zalo's Official Account platform.

import { z } from 'zod'

import {
  allowlistField,
  deliveryFields,
  parseChannelSection,
  resolveAdmissionIds,
} from '@/channels/schema'
import { channelId } from '@/core/channels'

export const ZALO_PERSONAL_CHANNEL_ID = channelId('zalo_personal')
const ZALO_PERSONAL_DEFAULT_PROFILE = 'default'

const zaloPersonalSchema = z.strictObject({
  ...deliveryFields,
  allowed_ids: allowlistField,
  operator_user_ids: allowlistField,
  // No default: the operator must state, in config, that they accept the ban risk.
  i_accept_ban_risk: z.boolean().optional(),
  // Which stored QR login this channel uses, so two accounts can be linked side by side.
  profile: z.string().min(1).default(ZALO_PERSONAL_DEFAULT_PROFILE),
})

export type ZaloPersonalChannelConfig = z.infer<typeof zaloPersonalSchema>

export type ZaloPersonalBlocker = 'disabled' | 'ban_risk_not_accepted' | 'no_allowed_ids'

export function parseZaloPersonalConfig(raw: unknown): ZaloPersonalChannelConfig {
  return parseChannelSection(zaloPersonalSchema, raw, ZALO_PERSONAL_CHANNEL_ID)
}

export function isZaloPersonalEnabled(config: ZaloPersonalChannelConfig): boolean {
  return zaloPersonalBlocker(config) === undefined
}

// Both guards are deliberate ban-risk defences: opt in AND name every chat. Never pairs a stranger.
export function zaloPersonalBlocker(
  config: ZaloPersonalChannelConfig
): ZaloPersonalBlocker | undefined {
  if (config.enabled === false) {
    return 'disabled'
  }

  if (config.i_accept_ban_risk !== true) {
    return 'ban_risk_not_accepted'
  }

  if (resolveAdmissionIds(config).allowedIds.length === 0) {
    return 'no_allowed_ids'
  }

  return undefined
}

import { z } from 'zod'

import type { AdmissionMode } from '@/channels/types'
import {
  allowlistField,
  deliveryFields,
  dmPolicyField,
  parseChannelSection,
  resolveAdmissionIds,
  secretFields,
} from '@/channels/schema'
import { channelId } from '@/core/channels'

export const ZALO_CHANNEL_ID = channelId('zalo')

const zaloSchema = z.strictObject({
  ...deliveryFields,
  ...secretFields,
  allowed_ids: allowlistField,
  operator_user_ids: allowlistField,
  dm_policy: dmPolicyField,
})

type ZaloChannelConfig = z.infer<typeof zaloSchema>

export type ResolvedZaloConfig = ZaloChannelConfig & { readonly configured: boolean }

export function parseZaloConfig(raw: unknown): ResolvedZaloConfig {
  const parsed = parseChannelSection(zaloSchema, raw, ZALO_CHANNEL_ID)

  return { ...parsed, configured: raw !== undefined }
}

/** With no `dm_policy`, Zalo follows Telegram: a listed id means the operator chose who gets in, so
 *  strangers are not offered a pairing code. */
export function zaloAdmissionMode(config: ResolvedZaloConfig): AdmissionMode {
  const policy = config.dm_policy ?? (hasAllowedIds(config) ? 'allowlist' : 'pairing')

  return policy === 'allowlist' ? 'allowlist' : 'pairing'
}

function hasAllowedIds(config: ResolvedZaloConfig): boolean {
  return resolveAdmissionIds(config).allowedIds.length > 0
}

export function isZaloEnabled(config: ResolvedZaloConfig): boolean {
  return config.configured && config.enabled !== false && config.dm_policy !== 'disabled'
}

import { z } from 'zod'

import type { AdmissionMode } from '@/channels/types'
import { allowlistField, deliveryFields, dmPolicyField, secretFields } from '@/channels/schema'

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
  const parsed = zaloSchema.parse(raw ?? {})
  return { ...parsed, configured: raw !== undefined }
}

export function zaloAdmissionMode(config: ResolvedZaloConfig): AdmissionMode {
  if (config.dm_policy === 'allowlist') {
    return 'allowlist'
  }

  return 'pairing'
}

export function isZaloEnabled(config: ResolvedZaloConfig): boolean {
  return config.configured && config.enabled !== false && config.dm_policy !== 'disabled'
}

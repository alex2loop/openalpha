import { z } from 'zod'

import {
  allowlistField,
  deliveryFields,
  resolveAdmissionIds,
  secretFields,
} from '@/channels/schema'

const telegramSchema = z.strictObject({
  ...deliveryFields,
  ...secretFields,
  allowed_ids: allowlistField,
  operator_user_ids: allowlistField,
  pairing: z.boolean().optional(),
})

type TelegramChannelConfig = z.infer<typeof telegramSchema>

export type ResolvedTelegramConfig = TelegramChannelConfig & { readonly configured: boolean }

export function parseTelegramConfig(raw: unknown): ResolvedTelegramConfig {
  const parsed = telegramSchema.parse(raw ?? {})
  return { ...parsed, configured: raw !== undefined }
}

// Pairing defaults ON with no allowlist, so a bare token prompts to pair rather than locking everyone out.
export function isTelegramPairingEnabled(config: TelegramChannelConfig): boolean {
  if (config.pairing !== undefined) {
    return config.pairing
  }

  return resolveAdmissionIds(config).allowedIds.length === 0
}

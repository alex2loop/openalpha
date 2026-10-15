import type {
  ChannelAdapter,
  ChannelAdmission,
  ChannelContext,
  ChannelDefinition,
} from '@/channels/types'
import {
  resolveAdmissionIds,
  resolveSecret,
  SAFE_DELIVERY_OVERRIDE_FIELDS,
} from '@/channels/schema'
import { channelId } from '@/core/channels'

import { createTelegramAdapter } from './adapter'
import {
  isTelegramPairingEnabled,
  parseTelegramConfig,
  type ResolvedTelegramConfig,
} from './config'

const TELEGRAM_CHANNEL_ID = channelId('telegram')

export const telegramDefinition: ChannelDefinition<ResolvedTelegramConfig> = {
  id: TELEGRAM_CHANNEL_ID,
  safeConfigOverrides: SAFE_DELIVERY_OVERRIDE_FIELDS,
  resolveConfig: parseTelegramConfig,
  isEnabled: (config) => config.configured && config.enabled !== false,
  admission: (config): ChannelAdmission => ({
    mode: isTelegramPairingEnabled(config) ? 'pairing' : 'allowlist',
    ...resolveAdmissionIds(config),
  }),
  create: (config, context): ChannelAdapter => {
    if (isTelegramPairingEnabled(config) && resolveAdmissionIds(config).allowedIds.length === 0) {
      warnPairingOpen(context)
    }

    return createTelegramAdapter({
      token: resolveSecret(config, context.env),
      pollOffsets: context.pollOffsets,
      inbox: context.inbox,
      logger: context.logger,
    })
  },
}

function warnPairingOpen(context: ChannelContext): void {
  context.logger.warn('telegram.pairing_open', {
    detail:
      'pairing is open with no allowed_ids — any Telegram user can request a code; approve via pairing commands or set channels.telegram.allowed_ids to disable pairing',
  })
}

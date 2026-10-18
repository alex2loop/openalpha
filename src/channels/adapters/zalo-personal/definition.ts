import type { ChannelAdmission, ChannelContext, ChannelDefinition } from '@/channels/types'
import { resolveAdmissionIds } from '@/channels/schema'

import { createZaloPersonalAdapter } from './adapter'
import {
  isZaloPersonalEnabled,
  parseZaloPersonalConfig,
  ZALO_PERSONAL_CHANNEL_ID,
  type ZaloPersonalChannelConfig,
} from './config'

export const zaloPersonalDefinition: ChannelDefinition<ZaloPersonalChannelConfig> = {
  id: ZALO_PERSONAL_CHANNEL_ID,
  resolveConfig: parseZaloPersonalConfig,
  isEnabled: isZaloPersonalEnabled,

  // Pairing is hardcoded false — a deliberate ban-risk guard, never config-driven: this channel must never admit strangers.
  admission(config: ZaloPersonalChannelConfig): ChannelAdmission {
    return {
      ...resolveAdmissionIds(config),
      mode: 'allowlist',
    }
  },

  create(config: ZaloPersonalChannelConfig, context: ChannelContext) {
    return createZaloPersonalAdapter({
      location: { dataDir: context.dataDir, profile: config.profile },
      inbox: context.inbox,
      logger: context.logger,
    })
  },
}

import type { ChannelAdmission, ChannelContext, ChannelDefinition } from '@/channels/types'
import {
  resolveAdmissionIds,
  resolveSecret,
  SAFE_DELIVERY_OVERRIDE_FIELDS,
} from '@/channels/schema'

import { createZaloAdapter } from './adapter'
import {
  isZaloEnabled,
  parseZaloConfig,
  type ResolvedZaloConfig,
  ZALO_CHANNEL_ID,
  zaloAdmissionMode,
} from './config'

export const zaloDefinition: ChannelDefinition<ResolvedZaloConfig> = {
  id: ZALO_CHANNEL_ID,
  safeConfigOverrides: SAFE_DELIVERY_OVERRIDE_FIELDS,
  resolveConfig: parseZaloConfig,
  isEnabled: isZaloEnabled,

  admission(config: ResolvedZaloConfig): ChannelAdmission {
    return {
      ...resolveAdmissionIds(config),
      mode: zaloAdmissionMode(config),
    }
  },

  create(config: ResolvedZaloConfig, context: ChannelContext) {
    return createZaloAdapter({
      token: resolveSecret(config, context.env),
      ...(config.token_env === undefined ? {} : { tokenEnv: config.token_env }),
      inbox: context.inbox,
      logger: context.logger,
    })
  },
}

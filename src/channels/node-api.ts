// Bun/Node-only public API of channels/: the adapters, the registry and the runtime that start them.
// Only `app` and `cli` import it; the browser bundle never reaches this file.
export { TELEGRAM_API_BASE } from '@/channels/adapters/telegram/protocol'
export { ZALO_API_BASE } from '@/channels/adapters/zalo/client'
export {
  parseZaloPersonalConfig,
  type ZaloPersonalBlocker,
  type ZaloPersonalChannelConfig,
  zaloPersonalBlocker,
} from '@/channels/adapters/zalo-personal/config'
export { readZaloPersonalCredentials } from '@/channels/adapters/zalo-personal/credentials'
export {
  loginZaloPersonal,
  type ZaloPersonalLoginOutcome,
  type ZaloPersonalLoginProgress,
} from '@/channels/adapters/zalo-personal/login'
export { resolveDefaultRecipient } from '@/channels/recipient'
export {
  assertChannelConfigs,
  channelsProvider,
  findChannelDefinition,
  resolveRegisteredChannelSettings,
} from '@/channels/registry'
export { resolveSecret } from '@/channels/schema'
export { startChannels } from '@/channels/start'

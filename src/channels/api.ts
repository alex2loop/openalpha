// Public API of channels/. Other modules import from here — never from channels/ internals.

export type { ChannelDeliveryConfig, ChannelSettings } from '@/channels/schema'
export type { AcknowledgedRouter, StartChannelsDeps, StartChannelsResult } from '@/channels/start'
export type {
  AcknowledgedSendResult,
  AdapterHandlers,
  ChannelAdapter,
  ChannelAdmission,
  ChannelCallbackQuery,
  ChannelCapabilities,
  ChannelContext,
  ChannelDefinition,
  ChannelOutbound,
  ChannelRenderer,
  ChannelRuntime,
  ChannelRuntimeSnapshot,
  ChannelStatus,
  EditRequest,
  InboundInbox,
  InboundInboxEntry,
  InboundMessage,
  InboxPayload,
  InboxStatus,
  OutboundButton,
  OutboundTarget,
  ReactionEmoji,
  ReactionRequest,
  SentRef,
} from '@/channels/types'
export type {
  PairingApproveResult,
  PairingRequestResult,
  PairingStore,
  PendingPairing,
  PollOffsetStore,
  SessionKey,
  SessionRouter,
} from '@/core/types/session'
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
export { type ChannelDefinitionInput, createChannel } from '@/channels/define'
export {
  channelsProvider,
  findChannelDefinition,
  resolveRegisteredChannelSettings,
} from '@/channels/registry'
export {
  resolveChannelSettings,
  resolveSecret,
} from '@/channels/schema'
export { startChannels } from '@/channels/start'

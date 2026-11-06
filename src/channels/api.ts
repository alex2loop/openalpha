// Portable public API of channels/: nothing here reaches a Bun or Node builtin, so the browser bundle
// can import it. Other modules import from here — never from channels/ internals.

export type { ChannelDeliveryConfig, ChannelSettings } from '@/channels/schema'
export type { AcknowledgedRouter, StartChannelsDeps, StartChannelsResult } from '@/channels/start'
export type {
  AcknowledgedSendOptions,
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
  OperatorNotices,
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
export { type ChannelDefinitionInput, createChannel } from '@/channels/define'
export { formatRunResultBody, toResearchMilestone } from '@/channels/delivery/format'

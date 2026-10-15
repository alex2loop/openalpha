import type { ActiveSlashRuns } from '@/channels/delivery/active-runs'
import type { FinalAnswer } from '@/channels/delivery/answer'
import type { Gate } from '@/channels/delivery/gate'
import type { Exchange } from '@/channels/delivery/orchestrator'
import type { InboundQueue } from '@/channels/delivery/queue'
import type { ChannelSettings } from '@/channels/schema'
import type { ChannelAdapter, ChannelCallbackQuery, OutboundButton } from '@/channels/types'
import type { SlashDispatcher, SpendReader } from '@/commands/api'
import type { ChannelId } from '@/core/channels'
import type { EventBus } from '@/core/events'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type { ChatBindingStore, SessionOpener, SessionQueue } from '@/core/types/session'
import type { AgentRegistry, RunRegistry } from '@/engine/api'

export interface InboundHandlerDeps {
  readonly channelId: ChannelId
  readonly gate: Gate
  readonly queue: InboundQueue
  readonly sessionQueue: SessionQueue
  readonly sessions: SessionOpener
  readonly dispatcher: SlashDispatcher
  readonly spend: SpendReader
  readonly adapter: ChannelAdapter
  readonly runRegistry: RunRegistry
  /** Shared with the callback path, so a cancel button aborts a slash run the way /stop does. */
  readonly slashRuns: ActiveSlashRuns
  readonly bindings: ChatBindingStore
  readonly agents: AgentRegistry
  readonly bus: EventBus
  readonly settings: ChannelSettings
  readonly signal: AbortSignal
  readonly runExchange: (exchange: Exchange) => Promise<void>
  readonly redeliver: (answer: FinalAnswer) => Promise<void>
  readonly sendText: (
    chatId: string,
    text: string,
    buttons?: readonly OutboundButton[]
  ) => Promise<void>
  readonly onCallback: (query: ChannelCallbackQuery) => Promise<void>
  readonly logger: Logger
  readonly locale: Locale
}

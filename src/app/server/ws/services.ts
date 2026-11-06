import type { SlashDispatcher } from '@/commands/api'
import type { EventBus } from '@/core/events'
import type { SessionId } from '@/core/ids'
import type { Logger } from '@/core/logging/logger'
import type { Locale } from '@/core/types/locale'
import type {
  ChatBindingStore,
  CommandLane,
  SessionOpener,
  SessionQueue,
} from '@/core/types/session'
import type { AgentProfile, Runner } from '@/engine/api'
import type { BrowserSessionStore } from '@/persistence/api'

/** Server-owned interface: a socket aborts the runs it owns and steers the one running. */
interface WsRunControl {
  abortSession(sessionId: SessionId, chatId: string): boolean
  steer(sessionId: SessionId, chatId: string, text: string): boolean
}

export interface WsServices {
  readonly agents: ReadonlyMap<string, AgentProfile>
  /** `[api] orders`: whether `/trade` may run from the app. */
  readonly apiOrders: boolean
  readonly bindings: ChatBindingStore
  readonly browserSessions: Pick<BrowserSessionStore, 'has'>
  readonly bus: EventBus
  readonly commandLane: CommandLane
  readonly locale: Locale
  readonly logger: Logger
  readonly runControl: WsRunControl
  readonly runner: Runner
  readonly sessionQueue: SessionQueue
  readonly sessions: SessionOpener
  readonly slashDispatcher: SlashDispatcher
}

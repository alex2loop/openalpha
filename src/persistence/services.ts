import type { App, Bind, ServiceProvider } from '@/core/container'
import type { AgentPauseStore } from '@/core/types/agent-pause'
import type {
  ChatBindingStore,
  PairingStore,
  PollOffsetStore,
  SessionRouter,
} from '@/core/types/session'
import type { SocialStore } from '@/core/types/social'
import type { Dialect, FtsSearch, Storage } from '@/core/types/storage'
import type { OpenedPersistence } from '@/persistence/connection'
import type { LLMAttemptStore, RunLogStore, SessionStore } from '@/persistence/types'
import { createFtsSearch } from '@/persistence/fts'
import { createAgentPauseStore } from '@/persistence/stores/agent-pause'
import { createChatBindingStore } from '@/persistence/stores/channel/chat-binding'
import { createPairingStore } from '@/persistence/stores/channel/pairing'
import { createPollOffsetStore, createSessionRouter } from '@/persistence/stores/channel/state'
import { createLLMAttemptStore } from '@/persistence/stores/llm-attempt'
import { createRunLogStore } from '@/persistence/stores/run-log'
import { createHeartbeatStore } from '@/persistence/stores/scheduler/heartbeat'
import { createJobStore } from '@/persistence/stores/scheduler/job/store'
import { createSchedulerOccurrenceStore } from '@/persistence/stores/scheduler/run'
import { createSessionStore } from '@/persistence/stores/session/store'
import { createSocialStore } from '@/persistence/stores/social/store'

declare module '@/core/container' {
  interface Services {
    storage: Storage
    dialect: Dialect
    sessionStore: SessionStore
    chatBindingStore: ChatBindingStore
    agentPauseStore: AgentPauseStore
    socialStore: SocialStore
    pairingStore: PairingStore
    sessionRouter: SessionRouter
    pollOffsetStore: PollOffsetStore
    jobStore: ReturnType<typeof createJobStore>
    schedulerOccurrenceStore: ReturnType<typeof createSchedulerOccurrenceStore>
    heartbeatStore: ReturnType<typeof createHeartbeatStore>
    llmAttemptStore: LLMAttemptStore
    runLogStore: RunLogStore
    fts: FtsSearch
  }
}

export function createPersistenceProvider(opened: OpenedPersistence): ServiceProvider {
  return {
    name: 'persistence',
    register(bind: Bind): void {
      bind('dialect', () => opened.dialect)
      bind('storage', () => opened.storage)

      bind('sessionStore', overStorage(createSessionStore))
      bind('chatBindingStore', overStorage(createChatBindingStore))
      bind('agentPauseStore', overStorage(createAgentPauseStore))
      bind('socialStore', overStorage(createSocialStore))
      bind('pairingStore', overStorage(createPairingStore))
      bind('sessionRouter', overStorage(createSessionRouter))
      bind('pollOffsetStore', overStorage(createPollOffsetStore))
      bind('jobStore', (app) =>
        createJobStore(app.resolve('storage'), app.resolve('dialect'), app.resolve('logger'))
      )
      bind('schedulerOccurrenceStore', overStorage(createSchedulerOccurrenceStore))
      bind('heartbeatStore', overStorage(createHeartbeatStore))
      bind('llmAttemptStore', (app) =>
        createLLMAttemptStore(
          app.resolve('storage'),
          app.resolve('dialect'),
          app.config.locale.timezone
        )
      )

      bind('runLogStore', overStorage(createRunLogStore))

      bind('fts', (app) =>
        createFtsSearch(app.resolve('storage'), app.resolve('dialect'), app.resolve('logger'))
      )
    },
  }
}

function overStorage<T>(create: (db: Storage, dialect: Dialect) => T): (app: App) => T {
  return (app) => create(app.resolve('storage'), app.resolve('dialect'))
}

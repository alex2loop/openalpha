import type { SessionId } from '@/core/ids'

export interface ActiveSlashRuns {
  register(sessionId: SessionId, chatId: string): AbortController
  unregister(sessionId: SessionId, chatId: string, controller: AbortController): void
  abortSession(sessionId: SessionId, chatId: string): boolean
  /** A chat-wide session reset knows no session id, so this keys on the chat alone. */
  abortChat(chatId: string): boolean
  abortAll(): void
}

export function createActiveSlashRuns(): ActiveSlashRuns {
  const active = new Map<SessionId, Map<string, Set<AbortController>>>()

  return {
    register(sessionId, chatId): AbortController {
      const controller = new AbortController()
      const byChat = active.get(sessionId) ?? new Map<string, Set<AbortController>>()
      const controllers = byChat.get(chatId) ?? new Set<AbortController>()

      controllers.add(controller)
      byChat.set(chatId, controllers)
      active.set(sessionId, byChat)
      return controller
    },

    unregister(sessionId, chatId, controller): void {
      const byChat = active.get(sessionId)
      const controllers = byChat?.get(chatId)

      if (byChat === undefined || controllers === undefined) {
        return
      }

      controllers.delete(controller)

      if (controllers.size === 0) {
        byChat.delete(chatId)
      }

      if (byChat.size === 0) {
        active.delete(sessionId)
      }
    },

    abortSession(sessionId, chatId): boolean {
      const controllers = active.get(sessionId)?.get(chatId)

      if (controllers === undefined || controllers.size === 0) {
        return false
      }

      for (const controller of controllers) {
        controller.abort()
      }

      return true
    },

    abortChat(chatId): boolean {
      let aborted = false

      for (const byChat of active.values()) {
        for (const controller of byChat.get(chatId) ?? []) {
          controller.abort()
          aborted = true
        }
      }

      return aborted
    },

    abortAll(): void {
      for (const byChat of active.values()) {
        for (const controllers of byChat.values()) {
          for (const controller of controllers) {
            controller.abort()
          }
        }
      }

      active.clear()
    },
  }
}

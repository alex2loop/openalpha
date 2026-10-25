import { effect, type ReadonlySignal, signal } from '@preact/signals'

import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { resumeAgentChoice } from '@/web/state/agents'
import { sessionId } from '@/web/state/chat'

export const HISTORY_PAGE_SIZE = 30
// Past this many earlier messages the panel stops offering more; the sessions dialog reads the rest.
export const MAX_EARLIER = 300

/** `more`: an older page exists; `start`: the session's first message is in view; `capped`: the
 *  panel holds all it keeps. */
type HistoryStatus = 'idle' | 'loading' | 'more' | 'start' | 'capped' | 'failed'

interface HistoryView {
  /** Oldest first. */
  readonly messages: readonly ChatHistoryMessage[]
  readonly status: HistoryStatus
  readonly failure?: ApiFailure
}

const EMPTY: HistoryView = Object.freeze({ messages: [], status: 'idle' })
// A session the page opened itself holds nothing older than its own turns.
const FRESH: HistoryView = Object.freeze({ messages: [], status: 'start' })

const view = signal<HistoryView>(EMPTY)
// The session the history was read for: only the one `/v1/chat/recent` named has earlier messages.
let historySession: string | undefined
let nextBefore: number | undefined
let lifetime: AbortController | undefined

/** The current session's earlier messages, above the turns sent on this page. */
export const history: ReadonlySignal<HistoryView> = view

/** Resumes the latest app session with its newest page; another session clears the history. */
export function startChatHistory(): () => void {
  const controller = new AbortController()

  lifetime = controller

  const stopSync = effect(() => {
    const session = sessionId.value

    if (session !== historySession) {
      historySession = undefined
      nextBefore = undefined
      view.value = session === undefined ? EMPTY : FRESH
    }
  })

  // `loadRecent` keeps its own failure, so it never rejects.
  loadRecent(controller.signal).catch(() => undefined)

  return () => {
    controller.abort()
    stopSync()

    if (lifetime === controller) {
      lifetime = undefined
    }
  }
}

/** The next older page of the current session; a call while one loads is ignored. */
export async function loadOlder(): Promise<void> {
  const session = historySession
  const abortSignal = lifetime?.signal
  const held = view.value

  if (session === undefined || abortSignal === undefined || !canLoad(held.status)) {
    return
  }

  view.value = { messages: held.messages, status: 'loading' }

  try {
    const page = await getJson(ROUTES.chatHistory(session), {
      query: {
        limit: HISTORY_PAGE_SIZE,
        ...(nextBefore === undefined ? {} : { before: nextBefore }),
      },
      signal: abortSignal,
    })

    if (historySession !== session) {
      return
    }

    const messages = [...page.messages].reverse().concat(held.messages)

    nextBefore = page.nextBefore ?? undefined
    view.value = {
      messages: messages.slice(-MAX_EARLIER),
      status: resolveStatus(page.hasMore, messages.length),
    }
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the stop's own abort.
    if (error instanceof ApiFailure && historySession === session) {
      view.value = { messages: held.messages, status: 'failed', failure: error }
    }
  }
}

function canLoad(status: HistoryStatus): boolean {
  return status === 'idle' || status === 'more' || status === 'failed'
}

function resolveStatus(hasMore: boolean, count: number): HistoryStatus {
  if (!hasMore) {
    return 'start'
  }

  return count >= MAX_EARLIER ? 'capped' : 'more'
}

// A session chosen on the page before the answer came keeps its place.
async function loadRecent(abortSignal: AbortSignal): Promise<void> {
  try {
    const recent = await getJson(ROUTES.chatRecent, { signal: abortSignal })

    if (recent.sessionId === null || sessionId.value !== undefined) {
      return
    }

    historySession = recent.sessionId
    sessionId.value = recent.sessionId
    resumeAgentChoice(recent.agentId)
    await loadOlder()
  } catch (error: unknown) {
    if (error instanceof ApiFailure) {
      view.value = { messages: [], status: 'failed', failure: error }
    }
  }
}

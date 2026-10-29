import { effect, type ReadonlySignal, signal } from '@preact/signals'

import type { ChatHistoryMessage } from '@/app/server/wire/chat'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { clearAgentChoice, resumeAgentChoice } from '@/web/state/agents'
import {
  APP_CHANNEL,
  type ChatSession,
  sessionId,
  startSession,
  viewedSession,
} from '@/web/state/chat'
import { onChatFrame } from '@/web/state/feed'

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
const opened = signal<ChatSession | undefined>(undefined)
const isGone = signal(false)
// The session the history was read for: only the one `/v1/chat/recent` named has earlier messages.
let historySession: string | undefined
let nextBefore: number | undefined
let lifetime: AbortController | undefined

/** The current session's earlier messages, above the turns sent on this page. */
export const history: ReadonlySignal<HistoryView> = view
/** The session a chat tab opened, which names the tab. */
export const openedSession: ReadonlySignal<ChatSession | undefined> = opened
/** The chat tab's session is gone, so the latest app session opened instead. */
export const isOpenedGone: ReadonlySignal<boolean> = isGone

/** Resumes the latest app session with its newest page, or on a chat tab the session it names;
 *  another session clears the history. */
export function startChatHistory(sessionToOpen?: string): () => void {
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

  const opening =
    sessionToOpen === undefined
      ? loadRecent(controller.signal)
      : openSessionById(sessionToOpen, controller.signal)

  // Each keeps its own failure, so neither rejects.
  opening.catch(() => undefined)

  // `/new` typed in the box moves the daemon's chat on; the page leaves the session it named.
  const stopReset = onChatFrame((frame) => {
    if (frame.kind === 'reset' && frame.sessionId === sessionId.value) {
      startNewSession()
    }
  })

  return () => {
    controller.abort()
    stopSync()
    stopReset()

    if (lifetime === controller) {
      lifetime = undefined
    }
  }
}

/** The column moves to a new session, as "Phiên chat mới" does once confirmed. */
export function startNewSession(): void {
  viewedSession.value = undefined
  startSession()
  clearAgentChoice()
  clearOpenedSession()
}

/** A new session leaves the one the chat tab opened, so the tab no longer goes by its name. */
function clearOpenedSession(): void {
  opened.value = undefined
}

/** Makes an app session the current one, as the sessions list opens it: typing goes to it and its
 *  newest page loads in place of the last session's. */
export function resumeAppSession(session: ChatSession): void {
  view.value = EMPTY
  resumeSession(session.sessionId, session.agentId)
  // `loadOlder` keeps its own failure in the view, so it never rejects.
  loadOlder().catch(() => undefined)
}

/** The "Older" button: the next older page, or once the latest session failed to load, that load again. */
export async function loadEarlier(): Promise<void> {
  const abortSignal = lifetime?.signal

  if (historySession !== undefined || abortSignal === undefined || view.value.status !== 'failed') {
    return loadOlder()
  }

  view.value = { messages: [], status: 'loading' }

  return loadRecent(abortSignal)
}

/** The next older page of the current session; a call while one loads is ignored. */
async function loadOlder(): Promise<void> {
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

    const messages = [...page.messages, ...held.messages]

    nextBefore = page.nextBefore ?? undefined
    view.value = {
      messages: toKeptMessages(messages),
      status: resolveStatus(page.hasMore, messages.length),
    }
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is the stop's own abort.
    if (error instanceof ApiFailure && historySession === session) {
      view.value = { messages: held.messages, status: 'failed', failure: error }
    }
  }
}

/** The newest `MAX_EARLIER`, never opening on an answer whose line was cut away. */
export function toKeptMessages(
  messages: readonly ChatHistoryMessage[]
): readonly ChatHistoryMessage[] {
  const kept = messages.slice(-MAX_EARLIER)

  return kept.length < messages.length && kept[0]?.role === 'assistant' ? kept.slice(1) : kept
}

function canLoad(status: HistoryStatus): boolean {
  return status === 'idle' || status === 'more' || status === 'failed'
}

/** Whether `count` rows leave the view holding all it keeps: it trimmed some, or is full with older
 *  rows left. A trimmed view never opens on the session's first message, whatever its last page says. */
export function isCapped(count: number, hasMore: boolean): boolean {
  return count > MAX_EARLIER || (hasMore && count === MAX_EARLIER)
}

function resolveStatus(hasMore: boolean, count: number): HistoryStatus {
  if (isCapped(count, hasMore)) {
    return 'capped'
  }

  return hasMore ? 'more' : 'start'
}

// A session chosen on the page before the answer came keeps its place.
async function loadRecent(abortSignal: AbortSignal): Promise<void> {
  try {
    const recent = await getJson(ROUTES.chatRecent, { signal: abortSignal })

    if (sessionId.value !== undefined) {
      return
    }

    // No session yet: a retry's spinner gives way to the empty column.
    if (recent.sessionId === null) {
      view.value = EMPTY
      return
    }

    resumeSession(recent.sessionId, recent.agentId)
    await loadOlder()
  } catch (error: unknown) {
    if (error instanceof ApiFailure) {
      view.value = { messages: [], status: 'failed', failure: error }
    }
  }
}

function resumeSession(id: string, agentId: string | undefined): void {
  historySession = id
  nextBefore = undefined
  sessionId.value = id
  resumeAgentChoice(agentId)
}

// An app session takes new messages; another channel's opens read-only beside the latest app
// session, as from the sessions list; an unknown one leaves the latest app session with a note.
async function openSessionById(id: string, abortSignal: AbortSignal): Promise<void> {
  const session = await findSession(id, abortSignal)

  opened.value = session

  if (session?.channel === APP_CHANNEL) {
    resumeSession(session.sessionId, undefined)
    await loadOlder()
    return
  }

  if (session !== undefined) {
    viewedSession.value = session
  }

  await loadRecent(abortSignal)
}

// Absent when it is gone (a malformed id names none either) or could not be read, which the latest
// session's own read then shows.
async function findSession(id: string, abortSignal: AbortSignal): Promise<ChatSession | undefined> {
  try {
    const { sessions } = await getJson(ROUTES.chatSessions, {
      query: { sessionId: id },
      signal: abortSignal,
    })

    isGone.value = sessions[0] === undefined

    return sessions[0]
  } catch (error: unknown) {
    isGone.value = error instanceof ApiFailure && error.code === 'invalid_body'

    return undefined
  }
}

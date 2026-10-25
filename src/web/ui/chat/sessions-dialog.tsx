import { type Signal, useSignal } from '@preact/signals'
import { useEffect } from 'preact/hooks'

import type { ChatSessionsResponse } from '@/app/server/wire/chat'
import type { LoadState } from '@/web/ui/kit/use-load'
import { pluralKey } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { setChatOpen } from '@/web/state/chat'
import { state } from '@/web/state/session'
import { ABSENT_CELL, joinInline } from '@/web/text/glyphs'
import { sourceLabel } from '@/web/text/source'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { type ChatSession, viewedSession } from '@/web/ui/chat/session-view'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'

const SEARCH_DEBOUNCE_MS = 300
// The daemon refuses a shorter search; a shorter box lists every session.
const SEARCH_MIN_CHARS = 2

/** Every channel's sessions, newest first, with a search; one opens read-only in the panel. */
export function openSessionsDialog(): void {
  openModal({
    title: tr('ui.office.sessions.title'),
    body: <SessionsBody />,
    footer: <Button onClick={closeModal}>{tr('ui.office.common.close')}</Button>,
    wide: true,
  })
}

function SessionsBody() {
  const query = useSignal('')
  const result = useSignal<LoadState<ChatSessionsResponse>>({ status: 'loading' })

  useEffect(() => armSearch(query.value.trim(), result), [query.value.trim()])

  return (
    <>
      <input
        type="search"
        class="sessions-search"
        placeholder={tr('ui.office.sessions.search')}
        aria-label={tr('ui.office.sessions.search')}
        value={query.value}
        onInput={(event) => (query.value = event.currentTarget.value)}
      />
      <SessionRows result={result.value} />
    </>
  )
}

// Waits out the typing, then reads; a newer search or the dialog closing drops both.
function armSearch(text: string, result: Signal<LoadState<ChatSessionsResponse>>): () => void {
  const controller = new AbortController()
  const search = text.length >= SEARCH_MIN_CHARS ? text : undefined
  const timer = setTimeout(
    () => {
      // `loadSessions` keeps its own failure in `result`, so it never rejects.
      loadSessions(search, result, controller.signal).catch(() => undefined)
    },
    search === undefined ? 0 : SEARCH_DEBOUNCE_MS
  )

  return () => {
    clearTimeout(timer)
    controller.abort()
  }
}

async function loadSessions(
  search: string | undefined,
  result: Signal<LoadState<ChatSessionsResponse>>,
  abortSignal: AbortSignal
): Promise<void> {
  try {
    const value = await getJson(ROUTES.chatSessions, {
      ...(search === undefined ? {} : { query: { query: search } }),
      signal: abortSignal,
    })

    result.value = { status: 'ready', value }
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is this search's own abort.
    if (error instanceof ApiFailure) {
      result.value = { status: 'failed', failure: error }
    }
  }
}

function SessionRows({ result }: { readonly result: LoadState<ChatSessionsResponse> }) {
  if (result.status === 'loading') {
    return <span class="spin" aria-hidden="true" />
  }

  if (result.status === 'failed') {
    return <p class="failure-line">{toFailureText(result.failure)}</p>
  }

  const { sessions } = result.value

  if (sessions.length === 0) {
    return <p class="meta">{tr('ui.office.sessions.none')}</p>
  }

  return (
    <ul class="sessions-list">
      {sessions.map((session) => (
        <li key={session.sessionId}>
          <SessionRow session={session} />
        </li>
      ))}
    </ul>
  )
}

function SessionRow({ session }: { readonly session: ChatSession }) {
  const timeZone = state.value?.timeZone
  const count = session.messageCount

  return (
    <button type="button" class="sessions-row" onClick={() => openSession(session)}>
      <b>{session.title ?? session.lastReply ?? session.sessionId}</b>
      <span class="meta">
        {joinInline([
          timeZone === undefined ? ABSENT_CELL : formatWhen(session.lastActivityAt, timeZone),
          sourceLabel(session.channel),
          tr(pluralKey(count, 'ui.office.sessions.countOne', 'ui.office.sessions.count'), {
            count,
          }),
        ])}
      </span>
    </button>
  )
}

function openSession(session: ChatSession): void {
  closeModal()
  viewedSession.value = session
  setChatOpen(true)
}

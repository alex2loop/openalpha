import type { RefObject } from 'preact'
import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { ChatSessionsResponse } from '@/app/server/wire/chat'
import type { ChatSession } from '@/web/state/chat'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { toFailureText, tr } from '@/web/text/tr'
import { isSessionDeleted, pruneDeleted, SessionGroups } from '@/web/ui/chat/sessions-rows'
import { Button } from '@/web/ui/kit/button'
import { closeModal, openModal } from '@/web/ui/kit/modal'
import { Skeleton } from '@/web/ui/kit/skeleton'

const SEARCH_DEBOUNCE_MS = 300
// The daemon refuses a shorter search; a shorter box lists every session.
const SEARCH_MIN_CHARS = 2
// What the list keeps as pages are added, as the ledger keeps its rows.
const SESSIONS_ROWS_MAX = 300

/** Newest first, then the next page's keyset; `next` absent on the last page or at the cap. */
interface SessionPages {
  readonly sessions: readonly ChatSession[]
  readonly next?: { readonly before: number; readonly beforeId: string }
  readonly isLoading: boolean
  readonly failure?: ApiFailure
}

const FIRST_LOAD: SessionPages = Object.freeze({ sessions: [], isLoading: true })

/** Every channel's sessions, newest first and grouped by day, with a search; one opens read-only in
 *  the chat column. */
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
  const pages = useSignal<SessionPages>(FIRST_LOAD)
  const inFlight = useRef<AbortController | undefined>(undefined)
  const text = query.value.trim()
  const search = text.length >= SEARCH_MIN_CHARS ? text : undefined
  const loadMore = (): void => readPage({ pages, search, inFlight })

  // A newer search or the dialog closing drops the wait and the read in flight.
  useEffect(() => {
    pages.value = FIRST_LOAD

    const timer = setTimeout(loadMore, search === undefined ? 0 : SEARCH_DEBOUNCE_MS)

    return () => {
      clearTimeout(timer)
      inFlight.current?.abort()
    }
  }, [search])

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
      <SessionsList pages={pages.value} search={search} onMore={loadMore} />
    </>
  )
}

interface ListProps {
  readonly pages: SessionPages
  readonly search: string | undefined
  readonly onMore: () => void
}

// A failed read keeps the rows already read under its line; Thử lại asks for the same page again.
function SessionsList({ pages, search, onMore }: ListProps) {
  const { next, isLoading, failure } = pages
  const sessions = pages.sessions.filter((session) => !isSessionDeleted(session))

  return (
    <>
      {failure !== undefined && (
        <>
          <p class="failure-line">
            {tr('ui.office.sessions.failed')} {toFailureText(failure)}
          </p>
          <Button size="small" disabled={isLoading} onClick={onMore}>
            {tr('ui.office.common.retry')}
          </Button>
        </>
      )}
      {sessions.length > 0 ? (
        <SessionGroups sessions={sessions} />
      ) : (
        <EmptyList search={search} pages={pages} />
      )}
      {next !== undefined && failure === undefined && (
        <div class="sessions-foot">
          <Button size="small" disabled={isLoading} onClick={onMore}>
            {isLoading && <span class="spin" aria-hidden="true" />}
            {tr('ui.office.sessions.more')}
          </Button>
        </div>
      )}
    </>
  )
}

interface EmptyProps {
  readonly search: string | undefined
  readonly pages: SessionPages
}

function EmptyList({ search, pages }: EmptyProps) {
  if (pages.isLoading) {
    return <Skeleton />
  }

  if (pages.failure !== undefined) {
    return null
  }

  return (
    <p class="empty-note">
      {search === undefined
        ? tr('ui.office.sessions.none')
        : tr('ui.office.sessions.noMatch', { query: search })}
    </p>
  )
}

interface PageRead {
  readonly pages: Signal<SessionPages>
  readonly search: string | undefined
  readonly inFlight: RefObject<AbortController | undefined>
}

// Reads the page after the ones held, or the first; a read already in flight gives way to it.
function readPage({ pages, search, inFlight }: PageRead): void {
  const held = pages.peek()
  const abort = new AbortController()

  inFlight.current?.abort()
  inFlight.current = abort
  pages.value = { ...held, isLoading: true }
  getJson(ROUTES.chatSessions, {
    query: {
      ...(search === undefined ? {} : { query: search }),
      ...(held.next === undefined ? {} : held.next),
    },
    signal: abort.signal,
  }).then(
    (page) => {
      const next = toPages(held.sessions, page)

      pages.value = next

      // A search shows only matches, so a row it leaves out proves nothing.
      if (search === undefined) {
        pruneDeleted(next.sessions, page.nextBefore === null)
      }
    },
    (error: unknown) => {
      // Anything but an `ApiFailure` is this list's own abort.
      if (error instanceof ApiFailure) {
        pages.value = { ...held, isLoading: false, failure: error }
      }
    }
  )
}

function toPages(held: readonly ChatSession[], page: ChatSessionsResponse): SessionPages {
  const sessions = [...held, ...page.sessions].slice(0, SESSIONS_ROWS_MAX)
  const { nextBefore, nextBeforeId } = page

  if (nextBefore === null || nextBeforeId === null || sessions.length >= SESSIONS_ROWS_MAX) {
    return { sessions, isLoading: false }
  }

  return { sessions, next: { before: nextBefore, beforeId: nextBeforeId }, isLoading: false }
}

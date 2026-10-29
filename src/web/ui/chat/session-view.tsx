import { type Signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { ChatHistoryMessage, ChatHistoryResponse } from '@/app/server/wire/chat'
import { pluralKey } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { type ChatSession, USER_ROLE, viewedSession } from '@/web/state/chat'
import {
  HISTORY_PAGE_SIZE,
  MAX_EARLIER,
  startNewSession,
  toKeptMessages,
} from '@/web/state/chat-history'
import { state } from '@/web/state/session'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { sourceLabel } from '@/web/text/source'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { HistoryMessages } from '@/web/ui/chat/history-message'
import { useNewerMessages } from '@/web/ui/chat/newer-messages'
import { useOlderPages } from '@/web/ui/chat/older-pages'
import { Button } from '@/web/ui/kit/button'

/** Oldest first; `nextBefore` absent once the first message is in view or the view holds all it
 *  keeps (`isCapped`). */
interface Pages {
  readonly messages: readonly ChatHistoryMessage[]
  readonly nextBefore?: number
  readonly isCapped?: true
  readonly isLoading: boolean
  readonly failure?: ApiFailure
}

const FIRST_PAGE: Pages = Object.freeze({ messages: [], isLoading: true })

/** An earlier session, read-only: typing still goes to the current one. Its reads stop on unmount. */
export function SessionView({ session }: { readonly session: ChatSession }) {
  const pages = useSignal<Pages>(FIRST_PAGE)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const list = useRef<HTMLDivElement>(null)
  const loadMore = (): void => {
    const abortSignal = lifetime.current?.signal

    if (abortSignal !== undefined && !abortSignal.aborted) {
      // `loadPage` keeps its own failure in `pages`, so it never rejects.
      loadPage(session.sessionId, pages, abortSignal).catch(() => undefined)
    }
  }
  const held = pages.value
  const onScroll = useOlderPages({
    list,
    oldest: held.messages[0],
    canLoad: !held.isLoading && held.nextBefore !== undefined && held.failure === undefined,
    // Not inside `loadMore`: the first page is asked for while `pages` already says loading.
    loadOlder: () => {
      if (!pages.value.isLoading) {
        loadMore()
      }
    },
  })

  useEffect(() => {
    const controller = new AbortController()

    lifetime.current = controller
    pages.value = FIRST_PAGE
    loadMore()

    return () => controller.abort()
  }, [session.sessionId])

  return (
    <div ref={list} class="chat-messages" role="log" aria-live="polite" onScroll={onScroll}>
      <ReadingBanner session={session} />
      <PagesHead pages={held} onOlder={loadMore} />
      <HistoryMessages messages={held.messages} />
      <EndNote count={session.turnCount} />
      <NewerRows sessionId={session.sessionId} pages={pages} list={list} />
    </div>
  )
}

interface NewerRowsProps {
  readonly sessionId: string
  readonly pages: Signal<Pages>
  readonly list: { readonly current: HTMLElement | null }
}

// What was said in the chat since it was read, taken in at the end of the list.
function NewerRows({ sessionId, pages, list }: NewerRowsProps) {
  const newer = useNewerMessages({
    sessionId,
    list,
    lastIdx: () => pages.value.messages.at(-1)?.idx,
    take: (page) => takeNewer(pages, page),
  })

  return newer.hasNewer ? (
    <div class="chat-newer">
      <Button size="small" onClick={newer.showNewer}>
        {tr('ui.office.chat.newer')}
      </Button>
    </div>
  ) : null
}

function EndNote({ count }: { readonly count: number }) {
  return (
    <p class="meta chat-start">
      {tr(pluralKey(count, 'ui.office.sessions.endOne', 'ui.office.sessions.end'), { count })}
    </p>
  )
}

function ReadingBanner({ session }: { readonly session: ChatSession }) {
  const timeZone = state.value?.timeZone

  return (
    <div class="chat-reading">
      <p>
        {tr('ui.office.sessions.reading', {
          when: timeZone === undefined ? ABSENT_CELL : formatWhen(session.startedAt, timeZone),
          channel: sourceLabel(session.channel),
        })}
      </p>
      <Button size="small" onClick={() => (viewedSession.value = undefined)}>
        {tr('ui.office.sessions.back')}
      </Button>
    </div>
  )
}

/** In place of the box while another channel's session is open: it is read here, never continued,
 *  since the daemon takes new messages only into a session this page started. */
export function ReadOnlyLine({ session }: { readonly session: ChatSession }) {
  return (
    <>
      <p class="meta command-box">
        {tr('ui.office.sessions.readOnly', { channel: sourceLabel(session.channel) })}
      </p>
      <Button kind="commit" onClick={startNewSession}>
        {tr('ui.office.sessions.continueNew')}
      </Button>
    </>
  )
}

interface PagesHeadProps {
  readonly pages: Pages
  readonly onOlder: () => void
}

function PagesHead({ pages, onOlder }: PagesHeadProps) {
  if (pages.isLoading) {
    return <span class="spin chat-start" aria-hidden="true" />
  }

  if (pages.isCapped === true) {
    return null
  }

  return (
    <>
      {pages.failure !== undefined && <p class="failure-line">{toFailureText(pages.failure)}</p>}
      {pages.nextBefore === undefined && pages.failure === undefined ? (
        <p class="meta chat-start">{tr('ui.office.chat.start')}</p>
      ) : (
        <Button size="small" onClick={onOlder}>
          {tr('ui.office.chat.older')}
        </Button>
      )}
    </>
  )
}

async function loadPage(
  sessionId: string,
  pages: Signal<Pages>,
  abortSignal: AbortSignal
): Promise<void> {
  const held = pages.value
  const before = held.nextBefore

  pages.value = { ...held, isLoading: true }

  try {
    const page = await getJson(ROUTES.chatHistory(sessionId), {
      query: { limit: HISTORY_PAGE_SIZE, ...(before === undefined ? {} : { before }) },
      signal: abortSignal,
    })

    const now = pages.value

    // Rows taken in at the end meanwhile stay; a list replaced meanwhile pages up on its own.
    pages.value =
      now.messages[0]?.idx === held.messages[0]?.idx
        ? toPages([...page.messages, ...now.messages], page)
        : { ...now, isLoading: false }
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is this view's own abort.
    if (error instanceof ApiFailure) {
      pages.value = { ...pages.value, isLoading: false, failure: error }
    }
  }
}

// `page` is the oldest page read, which says whether anything older is left to ask for.
function toPages(messages: readonly ChatHistoryMessage[], page: ChatHistoryResponse): Pages {
  const isCapped = messages.length >= MAX_EARLIER

  return {
    messages: toKeptMessages(messages),
    ...(page.hasMore && page.nextBefore !== null && !isCapped
      ? { nextBefore: page.nextBefore }
      : {}),
    ...(isCapped && page.hasMore ? { isCapped: true } : {}),
    isLoading: false,
  }
}

// The rows past the last one held are added at the end. A newest page that no longer reaches the
// rows held, more having arrived than one page holds, stands in for all of them instead, and older
// pages are read again on the way up. The end note counts the turns added.
function takeNewer(pages: Signal<Pages>, page: ChatHistoryResponse): void {
  const held = pages.value
  const last = held.messages.at(-1)?.idx ?? -1
  const fresh = page.messages.filter((message) => message.idx > last)
  const isJoined = !page.hasMore || (page.nextBefore !== null && page.nextBefore <= last)

  pages.value = isJoined ? withFresh(held, fresh) : toPages(page.messages, page)

  const viewed = viewedSession.value
  const turns = fresh.filter((message) => message.role === USER_ROLE).length

  if (viewed !== undefined) {
    viewedSession.value = { ...viewed, turnCount: viewed.turnCount + turns }
  }
}

// What older paging stood at still holds, unless the view now keeps all it can.
function withFresh(held: Pages, fresh: readonly ChatHistoryMessage[]): Pages {
  const messages = [...held.messages, ...fresh]

  if (messages.length <= MAX_EARLIER) {
    return { ...held, messages }
  }

  const { nextBefore: _dropped, ...rest } = held

  return { ...rest, messages: toKeptMessages(messages), isCapped: true }
}

import { type Signal, signal, useSignal } from '@preact/signals'
import { useEffect, useRef } from 'preact/hooks'

import type { ChatHistoryMessage, ChatSessionsResponse } from '@/app/server/wire/chat'
import { pluralKey } from '@/i18n'
import { ApiFailure, getJson } from '@/web/api/client'
import { ROUTES } from '@/web/api/routes'
import { HISTORY_PAGE_SIZE, MAX_EARLIER } from '@/web/state/chat-history'
import { state } from '@/web/state/session'
import { ABSENT_CELL } from '@/web/text/glyphs'
import { sourceLabel } from '@/web/text/source'
import { formatWhen } from '@/web/text/time'
import { toFailureText, tr } from '@/web/text/tr'
import { HistoryMessage } from '@/web/ui/chat/history-message'
import { Button } from '@/web/ui/kit/button'

export type ChatSession = ChatSessionsResponse['sessions'][number]

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

const viewed = signal<ChatSession | undefined>(undefined)

/** The earlier session open read-only in the panel; absent shows the current one. */
export const viewedSession: Signal<ChatSession | undefined> = viewed

/** An earlier session, read-only: typing still goes to the current one. Its reads stop on unmount. */
export function SessionView({ session }: { readonly session: ChatSession }) {
  const pages = useSignal<Pages>(FIRST_PAGE)
  const lifetime = useRef<AbortController | undefined>(undefined)
  const loadMore = (): void => {
    const abortSignal = lifetime.current?.signal

    if (abortSignal !== undefined && !abortSignal.aborted) {
      // `loadPage` keeps its own failure in `pages`, so it never rejects.
      loadPage(session.sessionId, pages, abortSignal).catch(() => undefined)
    }
  }

  useEffect(() => {
    const controller = new AbortController()

    lifetime.current = controller
    pages.value = FIRST_PAGE
    loadMore()

    return () => controller.abort()
  }, [session.sessionId])

  return (
    <div class="chat-messages" role="log" aria-live="polite">
      <ReadingBanner session={session} />
      <PagesHead pages={pages.value} onOlder={loadMore} />
      {pages.value.messages.map((message, index) => (
        // Counted from the newest, so an older page prepended never shifts a key.
        <HistoryMessage key={pages.value.messages.length - index} message={message} />
      ))}
      <p class="meta chat-start">
        {tr(
          pluralKey(session.messageCount, 'ui.office.sessions.endOne', 'ui.office.sessions.end'),
          {
            count: session.messageCount,
          }
        )}
      </p>
    </div>
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
      <p class="meta">{tr('ui.office.sessions.note')}</p>
      <Button size="small" onClick={() => (viewed.value = undefined)}>
        {tr('ui.office.sessions.back')}
      </Button>
    </div>
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

    const messages = [...page.messages].reverse().concat(held.messages)
    const isCapped = messages.length >= MAX_EARLIER

    pages.value = {
      messages: messages.slice(-MAX_EARLIER),
      ...(page.hasMore && page.nextBefore !== null && !isCapped
        ? { nextBefore: page.nextBefore }
        : {}),
      ...(isCapped && page.hasMore ? { isCapped: true } : {}),
      isLoading: false,
    }
  } catch (error: unknown) {
    // Anything but an `ApiFailure` is this view's own abort.
    if (error instanceof ApiFailure) {
      pages.value = { ...held, isLoading: false, failure: error }
    }
  }
}

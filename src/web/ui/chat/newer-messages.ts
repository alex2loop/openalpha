import { useSignal } from '@preact/signals'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'

import type { ChatHistoryResponse } from '@/app/server/wire/chat'
import { getJson } from '@/web/api/client'
import { startPoll } from '@/web/api/poll'
import { ROUTES } from '@/web/api/routes'
import { HISTORY_PAGE_SIZE } from '@/web/state/chat-history'
import { onWireEvent } from '@/web/state/events'
import { isAtEnd } from '@/web/ui/chat/older-pages'

// How often a chat open from another channel asks for what was said since. A run in it that ends
// asks at once; the poll catches a short command, which runs no run.
const NEWER_POLL_MS = 15_000

interface NewerInput {
  readonly sessionId: string
  /** The scrolling list. */
  readonly list: { readonly current: HTMLElement | null }
  /** The newest row held; absent until the first page lands. */
  readonly lastIdx: () => number | undefined
  /** Takes the newest page in. */
  readonly take: (page: ChatHistoryResponse) => void
}

interface NewerMessages {
  /** Rows arrived while the reader was scrolled up; they wait for `showNewer`. */
  readonly hasNewer: boolean
  readonly showNewer: () => void
}

/** Watches an open chat for messages said since it was read. At the newest line they come in at
 *  once and the list follows them; scrolled up, they wait, so the line being read never moves. */
export function useNewerMessages(input: NewerInput): NewerMessages {
  const waiting = useSignal<ChatHistoryResponse | undefined>(undefined)
  const latest = useRef(input)
  const isToEnd = useRef(false)

  latest.current = input

  useEffect(() => {
    const check = async (signal: AbortSignal): Promise<void> => {
      const page = await readNewer(latest.current, signal)
      const element = latest.current.list.current

      if (page === undefined) {
        return
      }

      if (element !== null && isAtEnd(element)) {
        isToEnd.current = true
        latest.current.take(page)
      } else {
        waiting.value = page
      }
    }

    return watchSession(input.sessionId, check)
  }, [input.sessionId])

  // After the rows are in, so the list ends on the newest one.
  useLayoutEffect(() => {
    const element = input.list.current

    if (isToEnd.current && element !== null) {
      isToEnd.current = false
      element.scrollTop = element.scrollHeight
    }
  })

  return {
    hasNewer: waiting.value !== undefined,
    showNewer: () => {
      const page = waiting.value

      waiting.value = undefined

      if (page !== undefined) {
        isToEnd.current = true
        input.take(page)
      }
    },
  }
}

// The newest page, when it holds a row past the last one shown.
async function readNewer(
  input: NewerInput,
  signal: AbortSignal
): Promise<ChatHistoryResponse | undefined> {
  const last = input.lastIdx()

  if (last === undefined) {
    return undefined
  }

  const page = await getJson(ROUTES.chatHistory(input.sessionId), {
    query: { limit: HISTORY_PAGE_SIZE },
    signal,
  })

  return page.messages.some((message) => message.idx > last) ? page : undefined
}

// The poll, and a run in this session ending. A failed read is tried again on the next tick; the
// page's own banner says when the daemon is gone.
function watchSession(
  sessionId: string,
  check: (signal: AbortSignal) => Promise<void>
): () => void {
  const lifetime = new AbortController()
  const ownRuns = new Set<string>()
  const stopPoll = startPoll(check, NEWER_POLL_MS)
  const offs = [
    onWireEvent('run_started', (event) => {
      if (event.runId !== undefined && event.run?.sessionId === sessionId) {
        ownRuns.add(event.runId)
      }
    }),
    onWireEvent('run_finished', (event) => {
      if (event.runId !== undefined && ownRuns.delete(event.runId)) {
        check(lifetime.signal).catch(() => undefined)
      }
    }),
  ]

  return () => {
    lifetime.abort()
    stopPoll()

    for (const off of offs) {
      off()
    }
  }
}

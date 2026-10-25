import { useEffect, useRef } from 'preact/hooks'

import { thread } from '@/web/state/chat'
import { history, loadOlder } from '@/web/state/chat-history'
import { toFailureText, tr } from '@/web/text/tr'
import { ApprovalInline } from '@/web/ui/chat/approval-inline'
import { HistoryMessage } from '@/web/ui/chat/history-message'
import { TurnCard } from '@/web/ui/chat/turn-card'
import { Button } from '@/web/ui/kit/button'

// How near the bottom still counts as reading the newest line.
const PIN_SLACK_PX = 24

/** The current session: its earlier messages, then what was sent on this page, newest last. */
export function MessageList() {
  const list = useRef<HTMLDivElement>(null)
  const turns = thread.value
  const earlier = history.value.messages

  const isPinned = useRef(true)

  // A new turn or a streamed delta keeps the newest line in view while the reader is at the bottom.
  useEffect(() => {
    const element = list.current

    if (element !== null && isPinned.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [turns])

  return (
    <div
      ref={list}
      class="chat-messages"
      role="log"
      aria-live="polite"
      onScroll={(event) => {
        const element = event.currentTarget

        isPinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_SLACK_PX
      }}
    >
      <HistoryHead />
      {earlier.map((message, index) => (
        // Counted from the newest, so an older page prepended never shifts a key.
        <HistoryMessage key={earlier.length - index} message={message} />
      ))}
      {turns.map((turn) => (
        <TurnCard key={turn.localId} turn={turn} />
      ))}
      <ApprovalInline />
    </div>
  )
}

function HistoryHead() {
  const { status, failure } = history.value

  // `loadOlder` keeps its own failure in `history`, so it never rejects.
  const older = (
    <Button size="small" onClick={() => loadOlder().catch(() => undefined)}>
      {tr('ui.office.chat.older')}
    </Button>
  )

  switch (status) {
    case 'more':
      return older
    case 'start':
      return <p class="meta chat-start">{tr('ui.office.chat.start')}</p>
    case 'failed':
      return (
        <>
          {failure !== undefined && <p class="failure-line">{toFailureText(failure)}</p>}
          {older}
        </>
      )
    case 'loading':
      return <span class="spin chat-start" aria-hidden="true" />
    default:
      return null
  }
}
